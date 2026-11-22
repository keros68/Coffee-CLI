# Windows terminal runtime

The Windows x64 bundle includes the unmodified Microsoft ConPTY runtime pair
recorded in `manifest.json`. The package supports Windows 10 build 17763 and
later. Both binaries carry a valid Microsoft signature.

`tauri.windows.conf.json` places both files beside `coffee-cli.exe`, where
the existing terminal library loads `conpty.dll` in preference to the system
console implementation. Keep `OpenConsole.exe` from the same package beside
the DLL. This avoids relying on the older console host shipped with Windows 10.

The files are vendored so source builds and release builds use the same runtime
without a build-time download. When updating, verify the official package,
both Microsoft signatures, and the SHA-256 values in the manifest. Run
`node src-ui/scripts/run-conpty-bundle-test.mjs` after replacing the pair.

The runtime is MIT licensed; `LICENSE.txt` is included in Windows installers as
`CONPTY-LICENSE.txt`. Windows 10 mouse compatibility still requires validation
on a Windows 10 machine; packaging and DLL-loading checks do not establish that.
