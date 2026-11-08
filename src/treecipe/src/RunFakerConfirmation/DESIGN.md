# Run Faker confirmation — design notes

`RunFakerConfirmation` imports only `crypto`, so it sits at layer 0 (#572). The Recipe Cockpit issues a token and Run Faker by Recipe spends it, and neither imports the other: before the move, the cockpit imported it from `ExtensionCommandService`, which kept the two folders in one cycle.

## Why a token, not a flag

The command is callable by id, so a flag in its arguments would let any caller skip the "Generate Data" question. The cockpit is issued a one-time random token in the extension host's memory, and the command skips its modal only for a token this class issued and has not yet spent (#255).

## Files

```
    ├── RunFakerConfirmation/
    │   └── RunFakerConfirmation.ts          # One-time tokens: the cockpit's own confirmation stands in for Run Faker's modal (#255); imports only crypto
```
