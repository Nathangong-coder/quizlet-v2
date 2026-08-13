"""Mutation harness: apply a defect, run a test file, confirm it reddens, revert.

Usage: python scripts/mutcheck.py <spec-file.json>
A guard with no failing run behind it is decoration; this is how we get the run.
"""
import subprocess, json, sys

def run(testpaths):
    r = subprocess.run(['npx.cmd', 'vitest', 'run', *testpaths],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode != 0

def main():
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    tests = spec['tests']
    files = sorted({f for m in spec['mutations'] for f, _, _ in m['edits']})
    originals = {f: open(f, encoding='utf-8').read() for f in files}
    ok = True
    try:
        for m in spec['mutations']:
            for f, a, b in m['edits']:
                t = open(f, encoding='utf-8').read()
                if a not in t:
                    print(f"PATTERN-MISS  {m['name']}  ({f})")
                    ok = False
                    break
                open(f, 'w', encoding='utf-8').write(t.replace(a, b, 1))
            else:
                killed = run(tests)
                print(('KILLED    ' if killed else 'SURVIVED  ') + m['name'])
                ok = ok and killed
            for f in files:
                open(f, 'w', encoding='utf-8').write(originals[f])
    finally:
        for f in files:
            open(f, 'w', encoding='utf-8').write(originals[f])
    print('ALL MUTANTS KILLED' if ok else 'SOME MUTANTS SURVIVED')

main()
