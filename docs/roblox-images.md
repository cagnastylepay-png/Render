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

