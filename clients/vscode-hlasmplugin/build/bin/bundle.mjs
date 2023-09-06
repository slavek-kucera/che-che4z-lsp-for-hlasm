import * as assert from 'assert';
import * as dts from 'dts-bundle-generator';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import { default as glob } from 'glob';
import * as path from 'path';

if (process.argv.length === 3 && process.argv[2] === 'selftest') {
    const err_msg = 'test msg';
    const err_predicate = e => e?.message === err_msg;

    for (const arg of [true, 1, {}, [], 'a'])
        ok(arg);

    for (const arg of [undefined, null, false, '', 0])
        assert.throws(() => ok(arg, err_msg), err_predicate);

    const testValues = [undefined, null, 0, -0, 1, false, true, [], [1], {}, { a: 1 }, '', 'a'];
    for (let li = 0; li < testValues.length; ++li) {
        for (let ri = 0; ri < testValues.length; ++ri) {
            if (li === ri)
                deepStrictEqual(testValues[li], testValues[ri]);
            else
                assert.throws(() => deepStrictEqual(testValues[li], testValues[ri], err_msg), err_predicate);
        }
    }

    process.exit(0);
}


const modes = ['extension', 'test', 'both'];
const targets = ['node', 'web'];

const [extension_or_test, node_or_web] = process.argv.slice(2);
const mode = 1 + modes.indexOf(extension_or_test);
const target = targets.indexOf(node_or_web);

assert.ok(mode > 0 && target >= 0, 'wrong parameters');

const tsconfig = path.resolve('tsconfig.json');

const buildDetails = [];
if ((mode & 1) === 1)
    buildDetails.push({
        main: {
            source: 'src/extension.ts',
            out: 'dist'
        },
        interface: {
            source: 'src/extension.interface.ts',
            out: 'typings/extension.d.ts',
        },
    });
if ((mode & 2) === 2)
    buildDetails.push({
        main: {
            source: target === 0 ? 'src/test/suite/index.ts' : 'src/test/suite/index.web.ts',
            out: 'dist_test',
        },
    });

for (const bd of buildDetails) {
    if (bd.interface) {
        console.log('Generating .d.ts file...');
        const dtsContent = dts.generateDtsBundle([{
            filePath: bd.interface.source,
            output: {
                noBanner: true,
                respectPreserveConstEnum: true,
                exportReferencedTypes: false
            }
        }], {
            preferredConfigPath: tsconfig
        });
        fs.mkdirSync(path.join(bd.interface.out, '..'), { recursive: true });
        fs.writeFileSync(bd.interface.out, dtsContent.join('\n'));
    }

    console.log('Building...');
    await esbuild.build({
        bundle: true,
        outdir: bd.main.out,
        entryPoints: [bd.main.source],
        sourcemap: true,
        tsconfig: tsconfig,
        external: target === 0 ? ['vscode', 'mocha'] : ['vscode'],
        minify: false,
        platform: target === 0 ? 'node' : 'browser',
        format: 'cjs',
        plugins: target === 0 ? undefined : [getWebPlugin()],
    });
}

console.log('Done!');

// details follow

function fileExists(dir, file) {
    try { return fs.statSync(path.join(dir, file)).isFile(); }
    catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
    }
}

function getWebPlugin() {
    const assertReplacement = [ok, strictEqual, match, deepStrictEqual];
    const assertReplacementSource = assertReplacement.map(x => 'export ' + x.toString()).join('\n');
    return {
        name: 'web-substitution',
        setup: (build) => {
            build.onResolve({ filter: /^[.]{1,2}\// }, args => fileExists(args.resolveDir, args.path + '.web.ts') && {
                path: path.join(args.resolveDir, args.path + '.web.ts'),
            } || undefined);
            build.onResolve({ filter: /^assert$/ }, args => ({
                path: args.path,
                namespace: 'assert',
            }));
            build.onLoad({ filter: /^assert$/, namespace: 'assert' }, () => ({
                contents: assertReplacementSource,
            }))
        },
    };
}

function ok(e, msg) { if (!e) throw Error(msg); }
function strictEqual(l, r, msg) { if (!Object.is(l, r)) throw Error(msg); }
function match(s, r, msg) { if (!r.test(s)) throw Error(msg); }
function deepStrictEqual(l, r, msg) {
    if (Object.is(l, r))
        return;

    if (typeof l !== 'object' || typeof r !== 'object')
        throw Error(msg);

    if ((l === null) !== (r === null))
        throw Error(msg);

    const larray = Array.isArray(l);
    const rarray = Array.isArray(r);

    if (larray !== rarray)
        throw Error(msg);
    else if (larray) {
        if (l.length !== r.length)
            throw Error(msg);

        for (let i = 0; i < l.length; ++i)
            deepStrictEqual(l[i], r[i], msg);
    }
    else {
        const lkey = Object.keys(l);
        const rkey = Object.keys(r);

        if (lkey.length !== rkey.length)
            throw Error(msg);

        for (const key of lkey) {
            if (!(key in r))
                throw Error(msg);

            deepStrictEqual(l[key], r[key], msg);
        }
    }
}
