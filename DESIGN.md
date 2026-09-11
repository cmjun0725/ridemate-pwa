# RideMate Design System

## Product character

RideMate is a Korean responsive cycling utility whose primary visual canvas is desktop while all core tasks remain usable on mobile. It should feel calm, dependable, and outdoor-oriented rather than playful or decorative. The visual anchor is a deep forest navigation/hero zone, a bright mineral-mint content canvas, and a high-visibility green route accent. This split makes navigation and primary actions immediately distinct from ride data.

## Visual principles

- Show the next useful action before explanatory copy.
- Use dark forest for orientation and bright surfaces for reading, forms, and data.
- Use one strong green accent; reserve red, amber, and blue for semantic states.
- Avoid nested cards. One surface groups one task; fields and dividers provide internal structure.
- Keep primary Korean text at 14px or larger and supporting text at 12px or larger.
- Use rounded corners selectively: 14px controls, 18px task surfaces, pill shapes only for compact filters and status.
- Route/map content should have the largest visual area in route confirmation and ride detail flows.
- Avoid automatic system-dark recoloring; RideMate uses one deliberate high-contrast product palette across devices.

## Runtime tokens

`src/design.css` is the canonical runtime token source.

- Canvas: `--rm-bg`
- Standard surface: `--rm-surface`
- Raised/interactive surface: `--rm-surface-raised`
- Quiet grouping: `--rm-soft`
- Primary text: `--rm-text`
- Secondary text: `--rm-muted`
- Border: `--rm-line`
- Brand/action: `--rm-accent`, `--rm-accent-strong`, `--rm-on-accent`
- Focus: `--rm-focus`
- Elevation: `--rm-shadow-sm`, `--rm-shadow-md`

## Responsive contract

- Mobile (< 680px): single-column content, bottom navigation, 16px page gutter, borderless create form shell.
- Tablet (680–899px): full-width content with 24px gutter and two-column repeatable cards where useful.
- Desktop (>= 900px): top navigation and a maximum 1360px content column; creation uses a stable left choice rail and right form.
- Desktop Home uses a wide editorial split hero: decisive copy on the left and a real Korean riverside riding scene on the right. The photograph is contextual, never decorative stock imagery, and keeps a stable 2:1 intrinsic ratio.
- On Home, the ride-search surface starts below the hero's visual lead; on desktop its lower edge aligns with the hero instead of competing at the same top edge.
- In Create, purpose and route-method controls share one two-column grid, gap, height, and horizontal alignment.

## Interaction contract

- Every enabled action has hover, focus-visible, active, disabled, and busy treatments.
- Primary actions use solid brand color. Secondary actions use a bordered surface. Destructive actions never reuse brand green.
- Selection is shown with background, border, and text/icon changes—not color alone.
- Feedback uses the shared toast system plus field-level validation where correction is required.
- Motion is short and optional; `prefers-reduced-motion` disables decorative transitions.
