# Streamliner for Scala Content Manager

Streamliner provides various conveniences and fixes for Scala Content Manager, packaged as a Chrome extension and as a Tampermonkey userscript. Both run the same
`streamliner.user.js`.

Streamliner changes only what the browser renders. It does not modify the
Content Manager server or any of its data.

To configure Streamliner, click your username in the upper-right, and select the **Streamliner Settings** entry that is added to that drop-down.

## Use of AI Coding Tools

This package was developed using Claude Code and Claude Opus 5.

## Features

### Dark Mode

Renders Content Manager using a dark mode theme. (Some images and other areas still need to be refined.)

### UI Transition Speed

Reduces or eliminates the delays introduced by Content Manager's UX transition animations.

### Text Only Compact Menus

(Content Manager 12.50 and up) Lays out Content Manager's compact side menus using text-only, which is easier to identify than the original icons-only.

### Focus Search

Adds a keyboard shortcut to focus each page's search box. Defaults to `/`, but can be changed to for example `Ctrl+k` or `Cmd+k`

### Host Identification

Shows the URL of this Content Manager on the login page and on the tab title. Useful if you're working with multiple instances.

### Login Button Fix

Fix a problem where autofill (e.g. from a password manager) can't login because Content Manager doesn't re-enable the disabled **Login** button in all cases.

## Installing Streamliner

### Install as a Chrome extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and pick this folder.
4. Reload any open Content Manager tab.

Chrome 111 or later is required, because the script must run in the page's own
JavaScript context to reach jQuery.

Chrome's prompt says the extension can read and change your data on all sites.
That is because the match pattern `*://*/ContentManager/*` puts the wildcard in
the host position, so colleagues do not have to edit anything for their own
server. The script still only runs on `/ContentManager` paths.

### Install as a userscript

1. Install the [Tampermonkey extension](https://www.tampermonkey.net/).
2. Open the [install link](https://raw.githubusercontent.com/pcherna/streamliner-for-scala-content-manager/main/streamliner.user.js). Tampermonkey offers to install it.
3. Reload any open Content Manager tab.

Tampermonkey then keeps itself up to date. It rechecks that same URL and
installs a new copy whenever the `@version` line goes up.

## Tested Versions

Streamliner is tested against the following versions of Scala Content Manager.

* 11.07.xx
* 12.00.xx
* 13.50.xx

## Scala

Scala Enterprise Content Manager is a product of [Scala](https://www.scala.com),
and the Scala name and logo are their trademarks. Streamliner is an independent
project. It is not affiliated with, endorsed by, or supported by Scala, and they
are in no way responsible for it.

Disclaimer: I used to work there.

## License

Copyright (C) 2026 Peter Cherna

Streamliner is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

Streamliner is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

The full text is in [LICENSE](LICENSE), and at
<https://www.gnu.org/licenses/gpl-3.0.html>.
