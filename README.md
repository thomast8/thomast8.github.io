# Nadir workout links

Static companion to Nadir issue367. Workouts travel in the URL fragment, never a server payload.
No dependencies, analytics, third-party resources, dynamic backend or stored workouts.

Get Nadir uses the existing enabled public Beta join link, read back through App Store Connect
and the actual Nadir TestFlight landing page on20October2026. This site does not enable a group
or add/promote a build. Deployment and installed-app association still need qualification.

Target repository/domain chosen in issue367: thomast8/thomast8.github.io. Publish the site files
without changing the workout fragment and preserve .well-known via .nojekyll. Validate HTTPS,
association/CDN responses and actual app handoff before claiming universal links work.

Checks: `just check` (`node --test workout.test.mjs`), plus an actual browser walk. Submit
`just check` through the shared queue on this Mac. The app's independent .nadir transport and
incoming-link confirmation have separate Core/App/native UI gates.

The preview reads the app's existing base64url JSON document locally, without compression,
personal-best pricing or a session executor. Version support follows Nadir's PlanFormatVersion
(currently through 12). Unknown versions keep the native handoff and show an update message;
malformed input shows no workout. Limits match the native wire's duration/depth/expansion bounds,
with the existing 2,000-character portable-link limit bounding all input before parsing.
The native importer remains responsible for full plan validation. Authored starting targets and
group changes are distinguished; the page does not expand repetitions or invent a total.
