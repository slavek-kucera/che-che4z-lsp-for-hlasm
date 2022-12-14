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

#ifndef HLASMPLUGIN_PARSERLIBRARY_LOCAL_LIBRARY_H
#define HLASMPLUGIN_PARSERLIBRARY_LOCAL_LIBRARY_H

#include <atomic>
#include <compare>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "diagnosable_impl.h"
#include "file_manager.h"
#include "library.h"

namespace hlasm_plugin::parser_library::workspaces {

#pragma warning(push)
#pragma warning(disable : 4250)

struct library_local_options
{
    std::vector<std::string> extensions;
    bool extensions_from_deprecated_source = false;
    bool optional_library = false;

#ifdef __cpp_lib_three_way_comparison
    auto operator<=>(const library_local_options&) const = default;
#else
    // libc++ (not even in main!!!)
    bool operator<(const library_local_options& o) const
    {
        if (extensions < o.extensions)
            return true;
        if (extensions > o.extensions)
            return false;
        if (extensions_from_deprecated_source < o.extensions_from_deprecated_source)
            return true;
        if (extensions_from_deprecated_source > o.extensions_from_deprecated_source)
            return false;
        if (optional_library < o.optional_library)
            return true;
        return false;
    }
#endif
};

// library holds absolute path to a directory and finds macro files in it
class library_local final : public library
{
public:
    // takes reference to file manager that provides access to the files
    // and normalised path to directory that it wraps.
    library_local(file_manager& file_manager,
        utils::resource::resource_location lib_loc,
        library_local_options options,
        utils::resource::resource_location proc_grps_loc);

    library_local(const library_local&) = delete;
    library_local& operator=(const library_local&) = delete;

    library_local(library_local&&) noexcept;

    const utils::resource::resource_location& get_location() const;

    void refresh() override;

    std::vector<std::string> list_files() override;

    std::string refresh_url_prefix() const override;

    bool has_file(std::string_view file, utils::resource::resource_location* url = nullptr) override;

    void copy_diagnostics(std::vector<diagnostic_s>& target) const override;

private:
    using files_collection_t = std::shared_ptr<const std::pair<std::unordered_map<std::string,
                                                                   utils::resource::resource_location,
                                                                   utils::hashers::string_hasher,
                                                                   std::equal_to<>>,
        std::vector<diagnostic_s>>>;
#if __cpp_lib_atomic_shared_ptr >= 201711L
    using atomic_files_collection_t = std::atomic<files_collection_t>;
#else
    class atomic_files_collection_t
    {
        files_collection_t m_data;

    public:
        atomic_files_collection_t() = default;
        atomic_files_collection_t(files_collection_t data)
            : m_data(std::move(data))
        {}
        auto load() const { return std::atomic_load(&m_data); }
        void store(files_collection_t data) { std::atomic_store(&m_data, std::move(data)); }
        auto exchange(files_collection_t data) { return std::atomic_exchange(&m_data, std::move(data)); }
    };
#endif

    file_manager& m_file_manager;

    utils::resource::resource_location m_lib_loc;
    atomic_files_collection_t m_files_collection;
    std::vector<std::string> m_extensions;
    bool m_optional = false;
    bool m_extensions_from_deprecated_source = false;
    utils::resource::resource_location m_proc_grps_loc;

    files_collection_t load_files();
    files_collection_t get_or_load_files();
};
#pragma warning(pop)

} // namespace hlasm_plugin::parser_library::workspaces
#endif
