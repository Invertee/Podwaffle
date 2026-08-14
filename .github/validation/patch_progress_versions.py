from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old!r}")
    file.write_text(text.replace(old, new, 1))

replace_once("apps/android/package.json", '  "version": "0.4.23",', '  "version": "0.4.24",')
replace_once("apps/android/app.config.ts", '  version: "0.4.23",', '  version: "0.4.24",')
replace_once("apps/android/app.config.ts", '    buildNumber: "27",', '    buildNumber: "28",')
replace_once("apps/android/app.config.ts", '    versionCode: 27,', '    versionCode: 28,')
replace_once("podwaffle/config.yaml", 'version: "5.0.23"', 'version: "5.0.24"')
replace_once(
    "CHANGELOG.md",
    "## Unreleased\n\n",
    "## Unreleased\n\n- Prevented stale Android/native or pending playback reports from moving saved progress backwards, preserved explicit offline rewinds, reconciled restored native playback to newer saved progress, updated Android to 0.4.24 / versionCode 28 while retaining native runtime 0.4-native-23, and bumped the Home Assistant add-on to 5.0.24.\n",
)
