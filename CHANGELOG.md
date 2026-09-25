# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [v0.1.1](https://github.com/OneAtDrt/stream_dock_network/releases/tag/v0.1.1) — Ring after page switch

### Fixed
* The Network knob ring stayed dark after a page switch or a Stream Dock restart until the first check finished (up to a minute). The plugin now remembers the last connection colour (also across restarts, in the temp folder, for up to 1 h) and repaints the ring as soon as the knob reappears; a fresh check corrects it within seconds
* Files: `plugin/index.js`, `CHANGELOG.md`; version 0.1.1 in `manifest.json`, `package.json`, `package-lock.json`

## [v0.1.0](https://github.com/OneAtDrt/stream_dock_network/releases/tag/v0.1.0) — Initial release

### Added
* **Network** knob action: turning cycles Status → Ping (one page per 3 hosts) → Speed and wraps; press runs the current page's action; the knob ring shows the connection (green online, amber slow, red offline) over USB HID (`knob-led.js` from Audio Control, shared-mode access, delayed and change-only writes) ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* **Network Status** action: online / slow / offline, external IP, country, ISP and a compact ↓/↑ line. Press copies the IP to the clipboard and refreshes ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* IP service **Auto** (default): IP from ipify (icanhazip fallback) every check, country/ISP from ipinfo.io only when the IP changes (cached per IP; a failed lookup is retried after an IP change or 1 h), which stays well inside ipinfo's free 50k requests/month. Also `ipinfo` (every check, optional token), `ipify`, `icanhazip`, `ip-api` (HTTP) ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* **Ping** action: latency to a list of 1–8 hosts (default US / EU / RU), 3 per page; turn to page, press to ping now. ICMP with automatic per-host fallback to TCP port 443 (remembered for 1 h), or TCP only ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* **Speed** action: download/upload rate of the default interface (`route` + `netstat -ibn`), auto or fixed units, bytes or bits (press toggles), 30-sample history ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* Property Inspector (one page for all four actions): intervals, IP service, ipinfo token, ping method, "slow above" threshold, host list with add/remove, units ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* Shared polling: actions with the same IP service / host list / speed sampler share one loop; panels are redrawn only when the image changes ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* `install.sh`, unit tests (`node --test`) ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* Key images from the approved design: status dot + label, page dots, country badge, compact ↓/↑ line, ping rows with latency bars (green < 100 ms, amber < 200 ms, red above/timeout) and a `tcp` tag for hosts reached over TCP, speed columns with a shared-scale history graph; checking / last-known-IP / IP copied / pending / no-network states ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* "Slow" only when at least half the hosts fail, or every reply is slower than the limit (one dead host among several stays green) ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* Knob rings shared with other Stream Dock plugins through a small state file (`knob-led.js`), so writing the Network ring doesn't reset e.g. Audio Control's knobs ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
* README preview images (`scripts/previews.js`) ([26e9031](https://github.com/OneAtDrt/stream_dock_network/commit/26e90312de2bea632a6862577e1cd1b9346204bf))
