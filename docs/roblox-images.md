# Native game image catalog

Extracted read-only from Roblox Studio on 2026-11-04: 263 categories plus two catalog aliases, 430 distinct asset IDs. `src/assets/roblox-images.json` stores the egg and animal image IDs separately as strings, alongside the display name.

Sources:
- `ReplicatedStorage.Shared.Types.Rift.Configs` in this Studio copy: `Icon` for the animal and `Egg.Icon` for its egg.
- `ReplicatedStorage.Data.HalloweenPets`, via `Data.Assets.HalloweenPetConfig`, for 30 special configurations.
- `ReplicatedStorage.Data.Assets.Directory` for aliases, including Abyss Overlord / Abyssal Overlord.

`getGameImageIds({category,name})` resolves category or display name and returns `{egg,animal}`. It does not change the current Render image URLs.

Direct public download was unavailable for the tested assets. Asset Delivery returned 401/403, while Roblox Thumbnails returned an unavailable-image placeholder despite reporting Completed.

The 174 distinct egg PNGs were subsequently downloaded through the normal free interface at https://rbxdl.johnmarctumulak.com/, individually and respecting its countdown. They are stored at `public/eggs-native/<assetId>.png`. The download manifest in `docs/native-eggs-download-progress.json` includes dimensions, SHA-256 hashes, sizes and remaining IDs. All 263 categories (plus two aliases) map to these 174 images. Animal IDs are included for future use; animal images have not been downloaded.

Render serves the PNGs with a one-day browser cache. The egg resolver prefers these files and falls back to the old Eggipedia catalog for unknown categories. `tools/sync-downloaded-eggs.cjs` imports matching PNGs from the local Downloads directory and updates the manifest.

## Live catalogue refresh — 2026-11-08

The Admin Images view reported 300 current game categories. The static catalogue now contains those categories plus the two existing Abyssal Overlord aliases (302 entries). `docs/live-image-catalog-updates.json` records 37 additions and five corrected existing entries. Centaur, Dark Gargoyle, Pegasus, Moth and Skeleton Horse had their egg/animal IDs reversed in the old Studio export; they now follow the live game's `Egg.Icon` and `Icon` respectively.

The new inventory and download status is in `docs/native-images-download-progress.json`. Both image roles still use the existing numeric `/eggs-native/<id>.png` route; the directory name does not determine the role. Files are imported by their actual filename asset ID, checked for PNG signature, and hashed. The normal rbxdl UI currently returns recurring expired security-token errors after partial downloads. Midnight Mimic's egg was separately reported unavailable. Remaining eggs and animals are explicitly listed as pending, not completed. `tools/sync-native-images.cjs` safely imports additional downloads and refreshes the manifest without overwriting existing files.

The resumed egg pass added 13 more PNGs (including the user's Nebuloth Kraken download), bringing current egg coverage to 197/204. The seven remaining egg IDs were retried in fresh tabs and still reported unavailable. `docs/native-image-failures.json` retains attempts and exact rbxdl error messages; `docs/images-a-recuperer.csv` lists missing images with names, roles, IDs, attempt counts and last messages. Animal downloads follow next, with one fresh-tab retry after each asset refusal and old tabs closed.


