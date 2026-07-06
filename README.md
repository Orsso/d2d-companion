# D2D Companion

A small extension that animates Dash to Dock with hover zoom, press feedback,
and launch animations.

It is a companion, not a dock. Dash to Dock does the dock work. This adds
the motion, and puts everything back when turned off.

## How it works

Hover and press feedback only listen to signals the dock icons already
emit. The launch animation is the one exception: it overrides
`AppIcon.animateLaunch` (the stock zoom) through GNOME Shell's official
`InjectionManager`, and restores it when the extension is disabled.
Nothing else in the Shell or in Dash to Dock is patched.

## Compatibility

D2D Companion declares support for GNOME Shell 46 to 50.

This beta was tested with:

- GNOME Shell 46 and 49
- Dash to Dock 105
- the standard GNOME Shell theme

Other setups may work, but I have not tested them for this release.

## Install

D2D Companion needs [Dash to Dock](https://extensions.gnome.org/extension/307/dash-to-dock/)
installed and enabled.

Download the `.shell-extension.zip` file from the
[GitHub release](https://github.com/Orsso/d2d-companion/releases), then run:

```bash
gnome-extensions install --force d2d-companion@orsso.github.io.shell-extension.zip
```

Log out and back in, then enable D2D Companion from the Extensions application.

## Development

```bash
npm ci
make check
make pack
```

`make check` runs lint, tests, package checks, and schema checks. `make pack`
builds the installable archive.

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has a short map
of the code.

Licensed under GPL-2.0-or-later.
