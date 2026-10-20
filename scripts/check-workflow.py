"""Check the workflow before spending a four-minute run on it.

Two checks, for two faults that each cost a real run:

1. Every `run:` block must parse as shell. Catches unbalanced quotes and the
   indented-heredoc-terminator problem (a heredoc inside a YAML block scalar
   cannot close itself, because its terminator has to sit at column 0).

2. No `run:` block may contain a LITERAL backslash-n where a line continuation
   was meant. `bash -n` is blind to this - `gh api ... \n -f branch=x` is
   perfectly valid shell, it just passes the two characters as an argument, and
   gh answers "accepts 1 arg(s), received 2". This has been introduced four
   times by writing the workflow through a shell heredoc, which eats one level
   of backslash. Legitimate `\n` inside a quoted PHP, Python or printf string
   is allowed; the signature of the bug is a `\n` followed by whitespace and
   then more command, with no quote opened on that line.

Usage: python3 scripts/check-workflow.py [.github/workflows/admin.yml]
"""
import io
import os
import re
import subprocess
import sys
import tempfile

import yaml

B = chr(92)
LIT = B + 'n'

PATH = sys.argv[1] if len(sys.argv) > 1 else '.github/workflows/admin.yml'
doc = yaml.safe_load(io.open(PATH, encoding='utf-8'))

problems = []


def run_blocks(doc):
    for job_name, job in (doc.get('jobs') or {}).items():
        for i, step in enumerate(job.get('steps') or []):
            if isinstance(step, dict) and 'run' in step:
                yield job_name, i, step.get('name', '(unnamed)'), step['run']


def shell_parses(body):
    # GitHub expressions are not shell; replace them with a bare word.
    text = re.sub(r'\$\{\{[^}]*\}\}', 'X', body)
    fd, path = tempfile.mkstemp(suffix='.sh', dir='.')
    try:
        with io.open(fd, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(text)
        # Pass the BASENAME, not the path: on Windows a git-bash child cannot
        # resolve the absolute path mkstemp returns (the backslashes are eaten)
        # and every step reports "No such file or directory", which looks like
        # fourteen broken steps instead of a broken checker.
        base = os.path.basename(path)
        r = subprocess.run(['bash', '-n', base], capture_output=True, text=True,
                           cwd=os.path.dirname(os.path.abspath(path)))
        return r.returncode == 0, r.stderr.strip().replace(base, '<step>')
    finally:
        os.unlink(path)


def mangled_continuations(body):
    """Lines where a literal backslash-n stands in for a continuation."""
    out = []
    for n, line in enumerate(body.split('\n'), 1):
        if LIT not in line:
            continue
        # A legitimate one sits inside quotes: printf '%s\n', "...\n", '\n'.join
        for m in re.finditer(re.escape(LIT), line):
            before = line[:m.start()]
            after = line[m.end():]
            quoted = (before.count("'") % 2) or (before.count('"') % 2)
            if quoted:
                continue
            # Unquoted, and followed by whitespace then more command text.
            if re.match(r'\s+\S', after):
                out.append((n, line.strip()))
                break
    return out


for job, idx, name, body in run_blocks(doc):
    ok, err = shell_parses(body)
    if not ok:
        problems.append(f'{name}: does not parse as shell\n      {err[:300]}')
    for n, line in mangled_continuations(body):
        problems.append(
            f'{name}: line {n} has a literal {LIT} where a continuation belongs'
            f'\n      {line[:160]}')

print(f'checked {PATH}')
if problems:
    for p in problems:
        print('  FAIL  ' + p)
    print(f'\n{len(problems)} problem(s)')
    sys.exit(1)
print('  all run blocks parse, and none has a mangled continuation')
