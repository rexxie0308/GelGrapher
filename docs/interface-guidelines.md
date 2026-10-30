# Interface hierarchy

GelGrapher separates settings, results, review warnings, and optional explanations. Preserve that separation when adding a feature.

| Content | Placement |
| --- | --- |
| Current measurement | Profile result card: lane/band, output name, value and units |
| A problem affecting this result | Visible status and reasons below the value; retain flags after user review |
| Measurements needing review | Visible count and Inspect next action in settings; expandable individual list |
| Next action | A labeled button beside the relevant control |
| Instructions for an active tool | Existing instruction bar for that workspace |
| Explanation or assumptions | Named expandable help beside the relevant setting |
| Numeric method details and provenance | Calculation details or Method and assumptions |

Do not use a tooltip as the only way to learn about a consequential operation. Keep exploratory-mode warnings and manual-baseline limitations visible. "Checked by you" records review; it does not establish scientific validity or remove export flags.

## Interaction

- Settings shortcuts reveal and focus the selected section. On a phone, they open the Settings workspace first. Arrow keys, Home, and End move between shortcuts; Enter or Space activates the focused button.
- Use `UI.openSettings(index, target)` when an action needs to reveal settings, including from another workspace. It opens the section and any enclosing disclosure and positions the target below the sticky navigation.
- Opening a section must not open its optional help automatically.
- Keep expanded review guidance open through redraws of the same measurement. Selecting another measurement starts with its own concise summary.
- Keep primary actions filled, secondary actions bordered, and help links underlined. Status chips are not buttons.
- Use theme tokens for interface colors. The exported figure remains independent of the interface theme.
- Keep one short explanation per control. Do not repeat the button label in an adjacent sentence unless the user needs a sequence of actions.

## Verification

The interface self-test covers section navigation, keyboard focus, help persistence, visible review reasons, and unchanged measurement values. The browser runner also checks that Method details is reachable from Analysis on a phone.

```sh
npm run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test -- --browser=chromium
npm run build
```

Inspect the Western and broad-band examples at desktop and phone widths, including dark mode. Check flagged and unflagged results, collapsed and expanded help, and manual baseline editing. These are interface checks, not experimental validation of densitometry.
