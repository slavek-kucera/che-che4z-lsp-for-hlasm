/*
 * Copyright (c) 2019 Broadcom.
 * The term "Broadcom" refers to Broadcom Inc. and/or its subsidiaries.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Broadcom, Inc. - initial API and implementation
 */

#ifndef HLASMPLUGIN_PARSERLIBRARY_WORKSPACE_MANAGER_IMPL_H
#define HLASMPLUGIN_PARSERLIBRARY_WORKSPACE_MANAGER_IMPL_H

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <deque>
#include <functional>
#include <limits>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "lsp/completion_item.h"
#include "lsp/document_symbol_item.h"
#include "nlohmann/json.hpp"
#include "protocol.h"
#include "utils/content_loader.h"
#include "utils/encoding.h"
#include "utils/error_codes.h"
#include "utils/path_conversions.h"
#include "utils/scope_exit.h"
#include "utils/task.h"
#include "workspace_manager.h"
#include "workspace_manager_external_file_requests.h"
#include "workspace_manager_response.h"
#include "workspaces/file_manager_impl.h"
#include "workspaces/workspace.h"

namespace hlasm_plugin::parser_library {

// Implementation of workspace manager (Implementation part of the pimpl idiom)
// Holds workspaces, file manager and macro tracer and handles LSP and DAP
// notifications and requests.

class workspace_manager::impl final : public diagnosable_impl, workspaces::external_file_reader
{
    static constexpr lib_config supress_all { 0 };
    using resource_location = utils::resource::resource_location;

    struct opened_workspace
    {
        opened_workspace(const resource_location& location,
            const std::string& name,
            workspaces::file_manager& file_manager,
            const lib_config& global_config)
            : ws(location, name, file_manager, global_config, settings)
        {}
        opened_workspace(workspaces::file_manager& file_manager, const lib_config& global_config)
            : ws(file_manager, global_config, settings)
        {}
        workspaces::shared_json settings = std::make_shared<const nlohmann::json>(nlohmann::json::object());
        workspaces::workspace ws;
    };

public:
    explicit impl(workspace_manager_external_file_requests* external_file_requests)
        : m_external_file_requests(external_file_requests)
        , m_file_manager(*this)
        , m_implicit_workspace(m_file_manager, m_global_config)
        , m_quiet_implicit_workspace(m_file_manager, supress_all)
    {}
    impl(const impl&) = delete;
    impl& operator=(const impl&) = delete;

    impl(impl&&) = delete;
    impl& operator=(impl&&) = delete;

    static auto& ws_path_match(auto& self, std::string_view document_uri)
    {
        if (auto hlasm_id = extract_hlasm_id(document_uri); hlasm_id.has_value())
        {
            if (auto related_ws = self.m_file_manager.get_virtual_file_workspace(hlasm_id.value()); !related_ws.empty())
                for (auto& [_, ows] : self.m_workspaces)
                    if (ows.ws.uri() == related_ws.get_uri())
                        return ows;
        }

        std::string replacement_uri;
        if (document_uri.starts_with(hlasm_external_scheme))
        {
            utils::path::dissected_uri uri_components = utils::path::dissect_uri(document_uri);
            if (uri_components.contains_host())
            {
                replacement_uri = utils::encoding::uri_friendly_base16_decode(uri_components.auth->host);
                if (!replacement_uri.empty())
                    document_uri = replacement_uri;
            }
        }

        size_t max = 0;
        decltype(&self.m_workspaces.begin()->second) max_ows = nullptr;
        for (auto& [name, ows] : self.m_workspaces)
        {
            size_t match = prefix_match(document_uri, ows.ws.uri());
            if (match > max && match >= name.size())
            {
                max = match;
                max_ows = &ows;
            }
        }
        if (max_ows != nullptr)
            return *max_ows;
        else if (document_uri.starts_with("file:") || document_uri.starts_with("untitled:"))
            return self.m_implicit_workspace;
        else
            return self.m_quiet_implicit_workspace;
    }

    // returns implicit workspace, if the file does not belong to any workspace
    auto& ws_path_match(std::string_view document_uri) { return ws_path_match(*this, document_uri); }
    auto& ws_path_match(std::string_view document_uri) const { return ws_path_match(*this, document_uri); }

    size_t get_workspaces(ws_id* workspaces, size_t max_size)
    {
        size_t size = 0;

        for (auto it = m_workspaces.begin(); size < max_size && it != m_workspaces.end(); ++size, ++it)
        {
            workspaces[size] = &it->second.ws;
        }
        return size;
    }

    size_t get_workspaces_count() const { return m_workspaces.size(); }

    enum class work_item_type
    {
        workspace_open,
        settings_change,
        file_change,
        query,
    };

    struct work_item
    {
        unsigned long long id;

        opened_workspace* ows;

        std::variant<std::function<void()>, std::function<void(bool)>, utils::task, std::function<utils::task()>>
            action;
        std::function<bool()> validator; // maybe empty

        work_item_type request_type;

        std::vector<std::pair<unsigned long long, std::function<void()>>> pending_requests;

        bool workspace_removed = false;

        bool is_valid() const { return !validator || validator(); }
        bool remove_pending_request(unsigned long long rid)
        {
            auto it = std::find_if(
                pending_requests.begin(), pending_requests.end(), [rid](const auto& e) { return e.first == rid; });

            if (it == pending_requests.end())
                return false;

            pending_requests.erase(it);
            return true;
        }
        void cancel_pending_requests() noexcept
        {
            for (const auto& [_, h] : pending_requests)
                h();
            pending_requests.clear();
        }

        bool is_task() const { return action.index() == 2 || action.index() == 3; }

        bool perform_action()
        {
            switch (action.index())
            {
                case 0:
                    if (!workspace_removed)
                        std::get<0>(action)();
                    return true;

                case 1:
                    std::get<1>(action)(workspace_removed);
                    return true;

                case 3:
                    if (workspace_removed)
                        return true;

                    if (auto t = std::get<3>(action)(); !t.valid())
                        return true;
                    else
                        action = std::move(t);
                    [[fallthrough]];

                case 2: {
                    if (workspace_removed)
                        return true;

                    const auto& task = std::get<2>(action);
                    if (!task.done())
                        task.resume(nullptr);

                    return task.done();
                }
                default:
                    return true;
            }
        }
    };

    work_item* find_work_item(unsigned long long id)
    {
        for (auto& wi : m_work_queue)
            if (wi.id == id)
                return &wi;
        return nullptr;
    }

    void add_workspace(std::string name, std::string uri)
    {
        auto& ows =
            m_workspaces.try_emplace(name, resource_location(std::move(uri)), name, m_file_manager, m_global_config)
                .first->second;
        ows.ws.set_message_consumer(m_message_consumer);

        auto& new_workspace = m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            std::function<utils::task()>([this, &ws = ows.ws]() -> utils::task {
                return ws.open().then([this]() { notify_diagnostics_consumers(); });
            }),
            {},
            work_item_type::workspace_open,
        });

        attach_configuration_request(new_workspace);
    }

    bool attach_configuration_request(work_item& wi)
    {
        if (!m_requests)
            return false;

        auto configuration_request = next_unique_id();

        struct open_workspace_t
        {
            unsigned long long work_item_id;
            unsigned long long request_id;
            impl* self;

            auto* get_wi() const
            {
                auto* wi = self->find_work_item(work_item_id);
                return wi && wi->remove_pending_request(request_id) ? wi : nullptr;
            }

            void provide(sequence<char> json_text) const
            {
                if (auto* wi = get_wi())
                    wi->ows->settings =
                        std::make_shared<const nlohmann::json>(nlohmann::json::parse(std::string_view(json_text)));
            }

            void error(int, const char*) const noexcept
            {
                static const auto empty = std::make_shared<const nlohmann::json>();
                if (auto* wi = get_wi())
                    wi->ows->settings = empty;
            }
        };

        auto [resp, _] = make_workspace_manager_response(open_workspace_t { wi.id, configuration_request, this });

        wi.pending_requests.emplace_back(configuration_request, [resp = resp]() noexcept { resp.invalidate(); });

        m_requests->request_workspace_configuration(wi.ows->ws.uri().c_str(), std::move(resp));

        return true;
    }

    ws_id find_workspace(const std::string& document_uri) { return &ws_path_match(document_uri).ws; }
    void remove_workspace(std::string uri)
    {
        auto it = m_workspaces.find(uri);
        if (it == m_workspaces.end())
            return; // erase does no action, if the key does not exist

        auto* ows = &it->second;

        for (auto& e : m_work_queue)
        {
            if (e.ows != ows)
                continue;

            e.workspace_removed = true;
            e.cancel_pending_requests();
        }
        if (m_active_task.ows == ows)
            m_active_task = {};

        m_workspaces.erase(it);
        notify_diagnostics_consumers();
    }

    bool run_active_task(const std::atomic<unsigned char>* yield_indicator)
    {
        const auto& [task, ows, start] = m_active_task;
        task.resume(yield_indicator);
        if (!task.done())
            return false;

        std::chrono::duration<double> duration = std::chrono::steady_clock::now() - start;

        const auto& [url, metadata, perf_metrics, errors, warnings] = task.value();

        if (perf_metrics)
        {
            parsing_metadata data { perf_metrics.value(), metadata, errors, warnings };
            for (auto consumer : m_parsing_metadata_consumers)
                consumer->consume_parsing_metadata(sequence<char>(url.get_uri()), duration.count(), data);
        }

        m_active_task = {};

        return true;
    }

    std::pair<bool, bool> run_parse_loop(opened_workspace& ows, const std::atomic<unsigned char>* yield_indicator)
    {
        auto result = std::pair<bool, bool>(false, true);
        while (true)
        {
            auto task = ows.ws.parse_file();
            if (!task.valid())
                break;

            m_active_task = { std::move(task), &ows, std::chrono::steady_clock::now() };

            if (!run_active_task(yield_indicator))
                return result;

            result.first = true;
        }
        result.second = false;
        return result;
    }

    bool run_parse_loop(const std::atomic<unsigned char>* yield_indicator, bool previous_progress)
    {
        constexpr auto combine = [](std::pair<bool, bool>& r, std::pair<bool, bool> n) {
            r.first |= n.first;
            r.second |= n.second;
        };
        auto result = run_parse_loop(m_implicit_workspace, yield_indicator);
        combine(result, run_parse_loop(m_quiet_implicit_workspace, yield_indicator));
        for (auto& [_, ows] : m_workspaces)
            combine(result, run_parse_loop(ows, yield_indicator));

        const auto& [progress, stuff_to_do] = result;

        if (progress || previous_progress)
            notify_diagnostics_consumers();

        return stuff_to_do;
    }

    static constexpr bool parsing_must_be_done(const work_item& item)
    {
        return item.request_type == work_item_type::query;
    }

    bool idle_handler(const std::atomic<unsigned char>* yield_indicator)
    {
        bool parsing_done = false;
        bool finished_inflight_task = false;
        while (true)
        {
            if (!m_work_queue.empty())
            {
                auto& item = m_work_queue.front();
                if (!item.pending_requests.empty() && item.is_valid())
                    return false;
                if (item.is_task() || item.workspace_removed || !item.is_valid() || parsing_done
                    || !parsing_must_be_done(item))
                {
                    bool done = true;
                    utils::scope_exit pop_front([this, &done]() noexcept {
                        if (done)
                        {
                            m_work_queue.front().cancel_pending_requests();
                            m_work_queue.pop_front();
                        }
                    });

                    if (item.request_type == work_item_type::file_change)
                    {
                        parsing_done = false;
                        m_active_task = {};
                    }

                    done = item.perform_action();

                    if (!done)
                        return false;

                    continue;
                }
            }
            else if (parsing_done)
                return false;

            if (m_active_task.valid())
            {
                if (!run_active_task(yield_indicator))
                    return true;
                finished_inflight_task = true;
            }

            if (run_parse_loop(yield_indicator, std::exchange(finished_inflight_task, false)))
                return true;

            parsing_done = true;
        }
    }

    void did_open_file(const utils::resource::resource_location& document_loc, version_t version, std::string text)
    {
        auto& ows = ws_path_match(document_loc.get_uri());
        auto open_result = std::make_shared<workspaces::file_content_state>();
        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            nullptr,
            [this, document_loc, version, text = std::move(text), open_result]() mutable {
                *open_result = m_file_manager.did_open_file(document_loc, version, std::move(text));
            },
            {},
            work_item_type::file_change,
        });
        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            std::function<utils::task()>([document_loc, &ws = ows.ws, open_result]() mutable {
                return ws.did_open_file(std::move(document_loc), *open_result);
            }),
            {},
            work_item_type::file_change,
        });
    }

    void did_change_file(const utils::resource::resource_location& document_loc,
        version_t version,
        const document_change* changes,
        size_t ch_size)
    {
        auto& ows = ws_path_match(document_loc.get_uri());

        struct captured_change
        {
            bool whole;
            range change_range;
            std::string text;
        };

        std::vector<captured_change> captured_changes;
        captured_changes.reserve(ch_size);
        std::transform(
            changes, changes + ch_size, std::back_inserter(captured_changes), [](const document_change& change) {
                return captured_change {
                    .whole = change.whole,
                    .change_range = change.change_range,
                    .text = std::string(change.text, change.text_length),
                };
            });

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            nullptr,
            [this, document_loc, version, captured_changes = std::move(captured_changes)]() {
                std::vector<document_change> list;
                list.reserve(captured_changes.size());
                std::transform(captured_changes.begin(),
                    captured_changes.end(),
                    std::back_inserter(list),
                    [](const captured_change& cc) {
                        return cc.whole ? document_change(cc.text.data(), cc.text.size())
                                        : document_change(cc.change_range, cc.text.data(), cc.text.size());
                    });
                m_file_manager.did_change_file(document_loc, version, list.data(), list.size());
            },
            {},
            work_item_type::file_change,
        });

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            std::function<utils::task()>(
                [document_loc,
                    &ws = ows.ws,
                    file_content_status = ch_size ? workspaces::file_content_state::changed_content
                                                  : workspaces::file_content_state::identical]() mutable {
                    return ws.did_change_file(std::move(document_loc), file_content_status);
                }),
            {},
            work_item_type::file_change,
        });
    }

    void did_close_file(const utils::resource::resource_location& document_loc)
    {
        auto& ows = ws_path_match(document_loc.get_uri());
        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            nullptr,
            [this, document_loc]() { m_file_manager.did_close_file(document_loc); },
            {},
            work_item_type::file_change,
        });
        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            std::function<utils::task()>(
                [document_loc, &ws = ows.ws]() mutable { return ws.did_close_file(std::move(document_loc)); }),
            {},
            work_item_type::file_change,
        });
    }

    void did_change_watched_files(std::vector<utils::resource::resource_location> affected_paths)
    {
        auto paths_for_ws = std::make_shared<std::unordered_map<opened_workspace*,
            std::pair<std::vector<resource_location>, std::vector<workspaces::file_content_state>>>>();
        for (auto& path : affected_paths)
        {
            auto& [path_list, _] = (*paths_for_ws)[&ws_path_match(path.get_uri())];
            path_list.emplace_back(std::move(path));
        }

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            nullptr,
            std::function<utils::task()>([this, paths_for_ws]() -> utils::task {
                std::vector<utils::task> pending_updates;
                for (auto& [_, path_change_list] : *paths_for_ws)
                {
                    auto& [paths, changes] = path_change_list;
                    changes.resize(paths.size());
                    auto cit = changes.begin();
                    for (const auto& path : paths)
                    {
                        auto update = m_file_manager.update_file(path);
                        auto& change = *cit++;
                        if (!update.valid())
                            change = workspaces::file_content_state::identical;
                        else if (update.done())
                            change = update.value();
                        else
                            pending_updates.emplace_back(std::move(update).then([&change](auto c) { change = c; }));
                    }
                }
                if (pending_updates.empty())
                    return {};
                return utils::task::wait_all(std::move(pending_updates));
            }),
            {},
            work_item_type::file_change,
        });

        for (auto& [ows, path_change_list] : *paths_for_ws)
            m_work_queue.emplace_back(work_item {
                next_unique_id(),
                ows,
                std::function<utils::task()>(
                    [path_change_list_p = std::shared_ptr<
                         std::pair<std::vector<resource_location>, std::vector<workspaces::file_content_state>>>(
                         paths_for_ws, &path_change_list),
                        &ws = ows->ws]() {
                        return ws.did_change_watched_files(
                            std::move(path_change_list_p->first), std::move(path_change_list_p->second));
                    }),
                {},
                work_item_type::file_change,
            });
    }

    void register_diagnostics_consumer(diagnostics_consumer* consumer) { m_diag_consumers.push_back(consumer); }
    void unregister_diagnostics_consumer(diagnostics_consumer* consumer)
    {
        m_diag_consumers.erase(
            std::remove(m_diag_consumers.begin(), m_diag_consumers.end(), consumer), m_diag_consumers.end());
    }

    void register_parsing_metadata_consumer(parsing_metadata_consumer* consumer)
    {
        m_parsing_metadata_consumers.push_back(consumer);
    }

    void unregister_parsing_metadata_consumer(parsing_metadata_consumer* consumer)
    {
        auto& pmc = m_parsing_metadata_consumers;
        pmc.erase(std::remove(pmc.begin(), pmc.end(), consumer), pmc.end());
    }

    void set_message_consumer(message_consumer* consumer)
    {
        m_message_consumer = consumer;
        m_implicit_workspace.ws.set_message_consumer(consumer);
        for (auto& wks : m_workspaces)
            wks.second.ws.set_message_consumer(consumer);
    }

    void set_request_interface(workspace_manager_requests* requests) { m_requests = requests; }

    static auto response_handle(auto r, auto f)
    {
        return [r = std::move(r), f = std::move(f)](bool workspace_removed) {
            if (!r.valid())
                r.error(utils::error::lsp::request_canceled);
            else if (workspace_removed)
                r.error(utils::error::lsp::removing_workspace);
            else
                f(r);
        };
    }

    void definition(const std::string& document_uri, position pos, workspace_manager_response<position_uri> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri), pos](
                    const workspace_manager_response<position_uri>& resp) {
                    resp.provide(position_uri(ws.definition(doc_loc, pos)));
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }

    void references(const std::string& document_uri, position pos, workspace_manager_response<position_uri_list> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri), pos](
                    const workspace_manager_response<position_uri_list>& resp) {
                    auto references_result = ws.references(doc_loc, pos);
                    resp.provide({ references_result.data(), references_result.size() });
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }

    void hover(const std::string& document_uri, position pos, workspace_manager_response<sequence<char>> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri), pos](
                    const workspace_manager_response<sequence<char>>& resp) {
                    auto hover_result = ws.hover(doc_loc, pos);
                    resp.provide(sequence<char>(hover_result));
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }


    void completion(const std::string& document_uri,
        position pos,
        const char trigger_char,
        completion_trigger_kind trigger_kind,
        workspace_manager_response<completion_list> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri), pos, trigger_char, trigger_kind](
                    const workspace_manager_response<completion_list>& resp) {
                    auto completion_result = ws.completion(doc_loc, pos, trigger_char, trigger_kind);
                    resp.provide(completion_list(completion_result.data(), completion_result.size()));
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }

    void document_symbol(
        const std::string& document_uri, long long limit, workspace_manager_response<document_symbol_list> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri), limit](
                    const workspace_manager_response<document_symbol_list>& resp) {
                    auto document_symbol_result = ws.document_symbol(doc_loc, limit);
                    resp.provide(document_symbol_list(document_symbol_result.data(), document_symbol_result.size()));
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }

    void configuration_changed(const lib_config& new_config)
    {
        // TODO: should this action be also performed IN ORDER?

        m_global_config = new_config;

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &m_implicit_workspace,
            std::function<utils::task()>([this, &ws = m_implicit_workspace.ws]() -> utils::task {
                return ws.settings_updated().then([this](bool u) {
                    if (u)
                        notify_diagnostics_consumers();
                });
            }),
            {},
            work_item_type::settings_change,
        });

        for (auto& [_, ows] : m_workspaces)
        {
            auto& refersh_settings = m_work_queue.emplace_back(work_item {
                next_unique_id(),
                &ows,
                std::function<utils::task()>([this, &ws = ows.ws]() -> utils::task {
                    return ws.settings_updated().then([this](bool u) {
                        if (u)
                            notify_diagnostics_consumers();
                    });
                }),
                {},
                work_item_type::settings_change,
            });

            attach_configuration_request(refersh_settings);
        }
    }

    void semantic_tokens(const char* document_uri, workspace_manager_response<continuous_sequence<token_info>> r)
    {
        auto& ows = ws_path_match(document_uri);

        m_work_queue.emplace_back(work_item {
            next_unique_id(),
            &ows,
            response_handle(r,
                [&ws = ows.ws, doc_loc = resource_location(document_uri)](
                    const workspace_manager_response<continuous_sequence<token_info>>& resp) {
                    resp.provide(make_continuous_sequence(ws.semantic_tokens(doc_loc)));
                }),
            [r]() { return r.valid(); },
            work_item_type::query,
        });
    }

    continuous_sequence<char> get_virtual_file_content(unsigned long long id) const
    {
        return make_continuous_sequence(m_file_manager.get_virtual_file(id));
    }

    void make_opcode_suggestion(const std::string& document_uri,
        const std::string& opcode,
        bool extended,
        workspace_manager_response<continuous_sequence<opcode_suggestion>> r)
    {
        // performed out of order
        auto suggestions =
            ws_path_match(document_uri)
                .ws.make_opcode_suggestion(utils::resource::resource_location(document_uri), opcode, extended);

        std::vector<opcode_suggestion> res;

        for (auto&& [suggestion, distance] : suggestions)
            res.emplace_back(opcode_suggestion { make_continuous_sequence(std::move(suggestion)), distance });

        r.provide(make_continuous_sequence(std::move(res)));
    }

private:
    void collect_diags() const override
    {
        collect_diags_from_child(m_implicit_workspace.ws);
        collect_diags_from_child(m_quiet_implicit_workspace.ws);
        for (auto& it : m_workspaces)
            collect_diags_from_child(it.second.ws);
    }

    static std::optional<unsigned long long> extract_hlasm_id(std::string_view uri)
    {
        static constexpr std::string_view prefix = "hlasm://";
        if (!uri.starts_with(prefix))
            return std::nullopt;
        uri.remove_prefix(prefix.size());
        if (auto slash = uri.find('/'); slash == std::string_view::npos)
            return std::nullopt;
        else
            uri = uri.substr(0, slash);

        unsigned long long result = 0;

        auto [p, err] = std::from_chars(uri.data(), uri.data() + uri.size(), result);
        if (err != std::errc() || p != uri.data() + uri.size())
            return std::nullopt;
        else
            return result;
    }

    void notify_diagnostics_consumers()
    {
        diags().clear();
        collect_diags();

        m_fade_messages.clear();
        m_implicit_workspace.ws.retrieve_fade_messages(m_fade_messages);
        m_quiet_implicit_workspace.ws.retrieve_fade_messages(m_fade_messages);
        for (const auto& [_, ows] : m_workspaces)
            ows.ws.retrieve_fade_messages(m_fade_messages);

        for (auto consumer : m_diag_consumers)
            consumer->consume_diagnostics(diagnostic_list(diags().data(), diags().size()),
                fade_message_list(m_fade_messages.data(), m_fade_messages.size()));
    }

    static size_t prefix_match(std::string_view first, std::string_view second)
    {
        auto [f, s] = std::mismatch(first.begin(), first.end(), second.begin(), second.end());
        return static_cast<size_t>(std::min(f - first.begin(), s - second.begin()));
    }

    unsigned long long next_unique_id() { return ++m_unique_id_sequence; }

    static constexpr std::string_view hlasm_external_scheme = "hlasm-external://";

    [[nodiscard]] utils::value_task<std::optional<std::string>> load_text_external(
        utils::resource::resource_location document_loc) const
    {
        struct content_t
        {
            std::optional<std::string> result;

            void provide(sequence<char> c) { result = std::string(c); }
            void error(int, const char*) noexcept { result.reset(); }
        };
        auto [channel, data] = make_workspace_manager_response(std::in_place_type<content_t>);
        m_external_file_requests->read_external_file(document_loc.get_uri().c_str(), channel);

        return [](auto channel, auto data) -> utils::value_task<std::optional<std::string>> {
            while (!channel.resolved())
                co_await utils::task::suspend();

            co_return std::move(data->result);
        }(std::move(channel), std::move(data));
    }

    [[nodiscard]] utils::value_task<std::optional<std::string>> load_text(
        const utils::resource::resource_location& document_loc) const override
    {
        if (!document_loc.get_uri().starts_with(hlasm_external_scheme))
            return utils::value_task<std::optional<std::string>>::from_value(utils::resource::load_text(document_loc));

        if (!m_external_file_requests)
            return utils::value_task<std::optional<std::string>>::from_value(std::nullopt);

        return load_text_external(document_loc);
    }

    [[nodiscard]] utils::value_task<std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
        utils::path::list_directory_rc>>
    list_directory_files_external(utils::resource::resource_location directory) const
    {
        using enum utils::path::list_directory_rc;
        struct content_t
        {
            explicit content_t(utils::resource::resource_location dir)
                : dir(std::move(dir))
            {}
            utils::resource::resource_location dir;
            std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
                utils::path::list_directory_rc>
                result;

            void provide(workspace_manager_external_directory_result c)
            {
                try
                {
                    std::string ext(c.suggested_extension);
                    auto& dirs = result.first;
                    for (auto s : c.members)
                    {
                        std::string file(s);
                        dirs.emplace_back(std::move(file), utils::resource::resource_location::join(dir, file + ext));
                    }
                }
                catch (...)
                {
                    result = { {}, other_failure };
                }
            }
            void error(int err, const char*) noexcept
            {
                if (err > 0)
                    result.second = not_a_directory;
                else if (err == 0)
                    result.second = not_exists;
                else
                    result.second = other_failure;
            }
        };
        auto [channel, data] = make_workspace_manager_response(std::in_place_type<content_t>, std::move(directory));
        m_external_file_requests->read_external_directory(data->dir.get_uri().c_str(), channel);

        return
            [](auto channel, auto data)
                -> utils::value_task<std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
                    utils::path::list_directory_rc>> {
                while (!channel.resolved())
                    co_await utils::task::suspend();

                co_return std::move(data->result);
            }(std::move(channel), std::move(data));
    }

    [[nodiscard]] utils::value_task<std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
        utils::path::list_directory_rc>>
    list_directory_files(const utils::resource::resource_location& directory) const override
    {
        if (!directory.get_uri().starts_with(hlasm_external_scheme))
            return utils::value_task<std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
                utils::path::list_directory_rc>>::from_value(utils::resource::list_directory_files(directory));

        if (!m_external_file_requests)
            return utils::value_task<std::pair<std::vector<std::pair<std::string, utils::resource::resource_location>>,
                utils::path::list_directory_rc>>::from_value({ {}, utils::path::list_directory_rc::not_exists });

        return list_directory_files_external(directory);
    }

    std::deque<work_item> m_work_queue;

    struct
    {
        utils::value_task<workspaces::parse_file_result> task;
        opened_workspace* ows = nullptr;
        std::chrono::steady_clock::time_point start_time;

        bool valid() const noexcept { return task.valid(); }
    } m_active_task;

    lib_config m_global_config;

    workspace_manager_external_file_requests* m_external_file_requests = nullptr;
    workspaces::file_manager_impl m_file_manager;

    std::unordered_map<std::string, opened_workspace> m_workspaces;
    opened_workspace m_implicit_workspace;
    opened_workspace m_quiet_implicit_workspace;

    std::vector<diagnostics_consumer*> m_diag_consumers;
    std::vector<parsing_metadata_consumer*> m_parsing_metadata_consumers;
    message_consumer* m_message_consumer = nullptr;
    workspace_manager_requests* m_requests = nullptr;
    std::vector<fade_message_s> m_fade_messages;
    unsigned long long m_unique_id_sequence = 0;
};
} // namespace hlasm_plugin::parser_library

#endif // !HLASMPLUGIN_PARSERLIBRARY_WORKSPACE_MANAGER_IMPL_H
