# RideMate UX Contract

## Navigation

- Home combines discovery and public ride search.
- Course opens nearby course exploration without requiring ride creation.
- Create preserves the selected purpose and route method while the user completes the form; Back returns without silently creating a room.
- My Rides contains saved/group/solo ride state. Profile and notifications remain in the header.

## Creation and route approval

- Group and solo riding keep both route methods: condition-based route candidates and fully manual input.
- A place is valid only after the user selects a verified address result.
- Manual and recommended routes must show a large map preview and require explicit approval before a ride is created.
- Group capacity means additional recruits and stays within the existing server limits.
- Solo ride date/time remains optional; group ride scheduling follows the existing validation rules.

## Async and feedback

- Pending actions prevent duplicate submission and keep button dimensions stable.
- Success is acknowledged through the shared toast/status system and navigates to the owning ride view.
- Recoverable failures retain entered values and explain the correction near the affected control.
- Empty, loading, no-result, offline, and permission-denied states keep stable layout and an honest recovery action.

## Safety and permissions

- Server-side authorization remains authoritative for participation, moderation, lifecycle, no-show voting, chat, and admin operations.
- Destructive/admin actions require the existing app-owned confirmation flow.
- Live location and emergency details are never exposed solely because the client requests them.

## Accessibility

- Target WCAG 2.2 AA.
- All actions use native buttons/links, controls have accessible names, and focus remains visible above sticky navigation.
- Touch targets are at least 44px where space permits; essential information is never communicated by color alone.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | `src/SelectMenu.tsx` | DESIGN + UX contract | authored / compact | keyboard + popup browser check |
| Date | Native date input | UX contract | native | locale + keyboard + browser check |
| Form | Application form handlers | UX contract | create / edit / search | validation tests + browser check |
| Scrollbar | Global rules in `src/design.css` | DESIGN | default / horizontal facility strip | computed style + browser check |
| Toast | `src/toast.tsx` | UX contract | success / info / error | live-region test + browser check |
| CRUD | Firebase services + callable functions | domain rules | return / stay | unit + flow verification |
