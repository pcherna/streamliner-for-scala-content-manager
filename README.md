# Streamliner for Scala Content Manager

Streamliner provides various conveniences and fixes for Scala Content Manager, packaged as a Chrome extension and as a userscript. Both run the same
`streamliner.user.js`.

Streamliner does not modify the Content Manager server or any of its data. Except as noted here, features change only what the browser renders, and never contact the server at all. The following features do read from Content Manager using the same API the page itself uses, and they send GET requests only:

* Template Usage
* Bypass Usage Dialog
* Maintenance Files Fixes
* Search Suggestions

To configure Streamliner, click your username in the upper-right, and select the **Streamliner Settings** entry that is added to that drop-down. In languages other than English, the entry is called **Streamliner**. The settings open by themselves once, the first time you sign in to each Content Manager server after installing Streamliner.

## Languages

Content Manager shows each user their own language. Text that Streamliner adds to Content Manager's pages uses Content Manager's own wording in that language, for example the usage counts and the usage dialog. A few additions have no wording in Content Manager. Outside English, the search box hint shows just the key, as in `Suchen [/]`. The usage breakdown uses Content Manager's own "Used:" label, and the settings entry is called **Streamliner**.

The built-in short labels for the compact menus are English, so they apply only in English. Labels you add in the settings apply in every language. The Streamliner settings panel itself is in English.

## Use of AI Coding Tools

This package was developed using Claude Code and Claude Opus 5.

## Features

### Dark Mode

Renders Content Manager using a dark mode theme. (Some images and other areas still need to be refined.)

### UI Transition Speed

Reduces or eliminates the delays introduced by Content Manager's UX transition animations.

### Text Only Compact Menus

(Content Manager 12.50 and up) Keeps Content Manager's compact side menus open, with text labels and section headers, which are easier to identify than the original icons-only.

### List Filters

The various list filters only show the first several entries, with the rest hidden behind Show More. Now all choices are shown initially, in a box that scrolls.

### Search Suggestions

Fixes a range of misbehaviors in the suggestions that a list's search box offers as you type. For example, a search could end up using a full media name that you never picked. Enter now searches for what you typed. Down opens the suggestions, and the arrow keys or a click pick one and search for it. Tab leaves the box without picking. On 13.50, picking a suggestion also runs the search, where Content Manager only fills in the box.

### Template Usage

Adds a Used: count to items in the template list, that links to those messages.

### Bypass Usage Dialog

Breaks a Used: count into its parts in the list, such as 2 Channels and 1 Message. Each part links straight to what it counts, instead of via the Usage Dialog.

### Section Links

(Content Manager 13.x) The side-menu entry for the section you are in, such as Playlists, stays a link while you are deeper in that section. It takes you back to the section's list.

### Timeslot Playlist Link

The Timeslot Properties dialog links to its playlist again. Content Manager shows the name as plain text to a user who belongs to no workgroup, even when that user can open the playlist.

### Non-Scheduled Content

A channel's Non-Scheduled Content tab links to its playlist, and reads Non-Scheduled Content (1) while a playlist is set, the way the tabs beside it show their counts.

### Frame List

The schedule page lists a channel's frames by name under the frame map, each one a click away, in place of the Select a Different Frame dialog. A frame hidden behind another on the map is easy to reach.

### Player Generate Plan

Player Properties shows a Generate Plan button when there are no unsaved changes, so you need not go back to the player list to generate the plan.

### Maintenance Files Fixes

Improves the file selection for a maintenance job's Install File task. It lists every file on one page, sorted without regard to case, and drops the warning icon on files in use. Upload opens the file chooser straight away, and a new upload is selected as soon as it appears. A task's Type list shows every choice without scrolling.

### Focus Search

Adds a keyboard shortcut to focus each page's search box. Defaults to `/`, but can be changed to for example `Ctrl+k` or `Cmd+k`. In a dialog, the shortcut reaches the dialog's own search box.

### Host Identification

Shows the URL of this Content Manager on the login page and on the tab title. Useful if you're working with multiple instances.

### Login Button Fix

Fixes a problem where autofill, for example from a password manager, can't log in because Content Manager doesn't re-enable the disabled **Login** button in all cases. On 13.50 it also makes Enter sign in, so a password manager that submits with Enter works.

## Installing Streamliner

### Install as a Chrome extension (Chrome, Edge, and other Chromium-based browsers)

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and pick this folder.
4. Reload any open Content Manager tab.

Chrome 111 or later is required, because the script must run in the page's own
JavaScript context to reach jQuery.

Chrome's prompt says the extension can read and change your data on all sites.
That is because the match pattern `*://*/ContentManager/*` puts the wildcard in
the host position, so colleagues do not have to edit anything for their own
server. The script still only runs on `/ContentManager` paths. Even there it
does nothing unless the page loads Content Manager's own files, so other
software at that path is left alone.

Chrome adds a Streamliner button to its extensions menu. Click it to see the
version number and a reminder of where the settings are. The button has no
controls of its own. Settings stay on the Content Manager page, under your
username.

Pin the button to the toolbar if you want it in view.

### Install as a userscript

On Chrome, prefer the extension above, because Chrome now makes you turn
userscripts on by hand. On Firefox and Safari this is the only route.

1. Install a userscript manager. [Violentmonkey](https://violentmonkey.github.io/)
   is open source and works on Chrome, Firefox and Safari.
   [Tampermonkey](https://www.tampermonkey.net/) is the other common choice.
2. Open the [install link](https://raw.githubusercontent.com/pcherna/streamliner-for-scala-content-manager/main/streamliner.user.js). The manager offers to install it.
3. Reload any open Content Manager tab.

The manager then keeps itself up to date. It rechecks that same URL and installs
a new copy whenever the `@version` line goes up.

Either manager runs Streamliner the same way. Streamliner declares `@grant none`,
so it uses none of the `GM_` functions that the two differ over.

On Chrome, a userscript manager also needs its own permission before it can run
anything. Open the manager's entry in `chrome://extensions` and turn on **Allow
user scripts**. The extension above needs no such step.

### Firefox and Safari

Neither can load this folder as an extension the way Chrome can, so both use the
userscript.

Firefox could run it as an extension in principle. Firefox 128 and later support
the page-context injection Streamliner needs. It would take a Gecko extension id
and a signed build from addons.mozilla.org, neither of which is set up here.

Safari is harder. A Safari extension has to be wrapped in a Mac app built with
Xcode, and shipping it to anyone else needs a paid Apple developer account.

## Development

The pure parts of the script have tests that run in Node with nothing
installed. They also check that the version agrees between `manifest.json`, the
`@version` header and the settings panel.

```
node --test
```

Anything that needs real layout or the app's own stylesheets is still tested
live, against the servers listed below.

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

The Streamliner icon is my own artwork. It is not the Scala logo, and it is not
derived from any Scala file.

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
