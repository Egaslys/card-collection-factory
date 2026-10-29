#!/usr/bin/env sh
# PreToolUse on Bash — refuses a command whose regex carries a large repetition
# count, such as `.\{0,3500\}` or `.{0,3500}`.
#
# GNU grep and GNU sed build their matcher from the pattern before reading any
# input, and a large {n,m} count makes that build grow without bound: one grep
# with {0,3500} was seen to take 71 GB in 18 minutes and bring down the IDE and
# the agent session. Measured on an empty file: count 500 — 0.4 s; 1000 — 3–7 s and 100–180 MB; 2000 and up — did
# not finish. A newer grep does not help: 3.11 behaves the same, and the GNU
# grep manual lists it under Known Bugs. ripgrep and Python take the same
# pattern in milliseconds, yet the count is refused in any program: telling
# them apart by command text is guesswork, and slicing text after a marker
# needs no regex at all.
#
# The deny rules in settings.json stop a plain `grep`; this hook covers what
# they cannot see — sed, grep by path, `bash -c`, `find -exec`.
#
# POSIX sh and awk, unlike the other hooks (Node): it runs before every Bash
# call, so it is one awk process and nothing else, and wherever the Bash tool
# exists sh exists too (on Windows the Bash tool requires Git Bash). settings.json
# runs it in shell form, through Git Bash: Windows' own PATH carries no sh, so the
# exec form (command + args) fails to spawn there and every command would go
# unchecked. It scans
# the raw JSON input without decoding it — braces are never escaped in JSON,
# and the backslashes of the basic syntax arrive doubled, which the pattern
# skips. Line endings must stay LF.

# Highest repetition count a command may carry. Above it GNU grep and sed stop
# building the pattern instantly and start taking seconds and hundreds of MB.
MAX_REPEAT=500

LC_ALL=C
export LC_ALL
exec awk -v max="$MAX_REPEAT" '
    { buf = buf (NR > 1 ? "\n" : "") $0 }
    END {
        # {N}, {N,}, {,M}, {N,M}, with or without backslashes before the brace.
        while (match(buf, /[{][0-9]*,?[0-9]*[\\]*[}]/)) {
            body = substr(buf, RSTART + 1, RLENGTH - 2)
            buf = substr(buf, RSTART + RLENGTH)
            gsub(/[\\]/, "", body)
            n = split(body, part, ",")
            for (i = 1; i <= n; i++)
                if (part[i] != "" && part[i] + 0 > max + 0) {
                    # The reason travels inside a JSON string: no quotes, backslashes or newlines.
                    printf "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Refused by the project hook: the command carries a regex repetition count of %d, the limit is %d. GNU grep and sed build such a pattern without bound - one grep with {0,3500} took 71 GB and crashed a machine. To take N characters after a marker, find the marker and slice the text in Node. To search, use the Grep tool or rg.\"}}\n", part[i], max
                    exit
                }
        }
    }'
