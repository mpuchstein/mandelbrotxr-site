# mandelbrotxr-site

Build output of the MandelbrotXR results site (generator: `site/build.py` in
[mpuchstein/MandelbrotXR](https://github.com/mpuchstein/MandelbrotXR)). Do not edit by hand.

Served at https://mandelbrotxr.puchstein.dev/ from the VPS as a nested submodule of
`vps_server/compose/caddy/sites/mandelbrotxr`.

Republish: rebuild into this repo and push. Then in vps_server run
`git submodule update --remote compose/caddy/sites/mandelbrotxr`, commit and push, and bump
the hosting pointer. The box update goes through the `patzer-hosting` session (vps_server README,
retro rule C6). Give it the vps_server sha. It fast-forwards `/srv/docker` to exactly that sha
(`fetch` + `merge --ff-only <sha>`) and then runs
`git submodule update compose/caddy/sites/mandelbrotxr`. Never a bare `pull`.
