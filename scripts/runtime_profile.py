"""Select whole TeX Live runtime packages, with explicit XeTeX-only exclusions."""
import hashlib
import json
import lzma
from pathlib import PurePosixPath


def package_index(data):
    records = {}
    for block in data.split('\n\n'):
        lines = block.splitlines()
        if not lines or not lines[0].startswith('name '):
            continue
        files, dependencies, active = set(), [], False
        for line in lines[1:]:
            if line.startswith('depend '):
                dependencies.append(line[7:])
            if line.startswith('runfiles '):
                active = True
            elif not line.startswith(' '):
                active = False
            elif active:
                files.add(PurePosixPath(line.strip().split()[0]).name)
        records[lines[0][5:]] = {'files': files, 'dependencies': dependencies}
    return records


def select_resources(policy_path, database_path):
    policy_bytes = policy_path.read_bytes()
    policy = json.loads(policy_bytes)
    index = package_index(lzma.decompress(database_path.read_bytes()).decode('utf-8'))
    packages = set()
    excluded = set(policy['excludePackages'])

    def visit(name):
        if name in packages or name in excluded or name.endswith('.ARCH'):
            return
        if name not in index:
            raise ValueError(f'Unknown TeX Live package: {name}')
        packages.add(name)
        for dependency in index[name]['dependencies']:
            visit(dependency)

    for name in policy['roots']:
        visit(name)
    # The upstream language.dat used during first-run format generation lists
    # every language. Retain all hyphenation data without unrelated font stacks.
    for name in index:
        if name.startswith('hyphen-'):
            visit(name)
    files = set(policy['extraFiles'])
    for name in packages:
        files.update(index[name]['files'])
    return policy, files, sorted(packages), hashlib.sha256(policy_bytes).hexdigest()
