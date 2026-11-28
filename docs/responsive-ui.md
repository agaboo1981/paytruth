# Responsive UI

## Layout decisions

- The viewport uses device width, supports safe-area insets and keyboard-driven resizing, and does not disable user zoom.
- Below 1280px, the header uses a disclosure menu containing navigation and wallet controls. It supports Escape, marks the active page, closes after navigation, and resets when resizing to desktop. The expanded header can scroll on short landscape screens.
- Content gutters scale from 16px to 24px to 32px and respect notches. Display typography is fluid; forms and invoice fields have shrinkable grid/flex children and wrap long addresses, descriptions, and amounts.
- The landing hero becomes two columns at 1024px. Primary landing actions fill the available width on phones. Invoice creation is constrained to a readable 760px container.
- Invoice details stack labels and values on phones. Merchant amounts use one column on phones, two on small tablets, and three on desktop. The invoice status filters scroll within their own container rather than widening the document.
- Mobile text inputs use at least 16px text to avoid automatic focus zoom on iOS. Theme, copy, and shared button controls have larger touch targets.
- Dialogs are height-constrained and scroll internally. Wallet dialogs, notifications, and the mobile claim bar account for small screens and/or safe-area insets. The claim bar leaves space for the footer.
- The local static server binds to all interfaces and redirects `/` to `/paytruth/` for hosted previews. The application retains its existing `/paytruth` deployment base path.

## Regression tests

From `app/`:

```sh
npm run typecheck
npm run lint
npm test
npm run build:mock
npx playwright install chromium
npm run test:responsive
```

`test:responsive` uses the existing Playwright static-preview configuration. Its 20 tests include:

- 29 page/state URLs at 13 viewport sizes: 320, 360, 390, 430, 640, 768, 820, 1024, 1280, 1440, and 1920px wide, plus 568×320 and 844×390 landscape viewports.
- Both collapsed and expanded technical details, with checks for document and body horizontal overflow.
- Mobile menu keyboard behavior, active links, navigation, and desktop/mobile resizing.
- Custom date/time inputs, large invoice amounts, unbroken descriptions, invoice creation, and generated pay links.
- 200% text sizing on a small phone in light mode.
- A touch-enabled mobile browser context checking viewport width, input focus, and the absence of zoom restrictions.
- WCAG A/AA automated accessibility scans of the expanded navigation, creation form, and invoice verdict in both themes.

The existing `flows.spec.ts` covers payment, claim, filtering, and history behavior and should also remain green. All transaction flows in these checks use the simulator; they do not send funds.

These are Chromium-based layout and accessibility checks, not certification on physical devices. Manual Safari/iOS and Android wallet-extension checks are recommended before release, especially for virtual keyboards and device-specific safe-area behavior.
