# mandelbrotxr-site

Build output of the MandelbrotXR results site (generator: `site/build.py` in
[mpuchstein/MandelbrotXR](https://github.com/mpuchstein/MandelbrotXR)). Do not edit by hand.

Served at https://mandelbrotxr.puchstein.dev/ from the VPS as a nested submodule of
`vps_server/compose/caddy/sites/mandelbrotxr`.

Republish: rebuild into this repo and push. Then in vps_server run
`git submodule update --remote compose/caddy/sites/mandelbrotxr`, commit and push, and bump
the hosting pointer. Move the box per the vps_server README (retro rule C6), never with a bare `pull`:
1. On the box, `git log --oneline HEAD..<sha>`.
2. Check every commit that isn't yours with its owner.
3. `sudo -u dockerdeploy git -C /srv/docker fetch && sudo -u dockerdeploy git -C /srv/docker merge --ff-only <sha>`,
   then `sudo -u dockerdeploy git -C /srv/docker submodule update compose/caddy/sites/mandelbrotxr`.

A Caddyfile change additionally needs validate + recreate, as a separate step with its own Go.
