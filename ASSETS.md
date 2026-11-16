# Art assets

The game renders real 3D models, not placeholders. They are built from the
packs supplied for this project:

| Pack | Used for | Licence |
| --- | --- | --- |
| KayKit — Medieval Builder Pack (Kay Lousberg) | castle, town hall, houses, market, windmill, quarry, barracks, smithy, archery range, stable, church, towers, walls, gate, ruins | CC0 |
| Quaternius — Fantasy Races Kit | Elf and Orc soldier meshes | CC0 |
| Quaternius — Universal Animation Library | idle / walk / jog / sword attack / spell / death clips (retargeted by bone name) | CC0 |
| Stylized Nature MegaKit | pines, twisted trees, dead trees, rocks, ferns | supplied with the project |
| Kenney / assorted props | tent (medical), axe, bow, mace, dagger, bull (cavalry mount) | CC0 |

## How `public/assets/models` is produced

`scripts/fetch-assets.py` downloads the original upload, keeps only the models
the game uses, then:

* merges each structure's sub-meshes into one mesh per material,
* resizes textures to 256–512 px and re-encodes the heavy ones to WebP,
* extracts the six animation clips used for troops into a single small file.

Result: ~13 MB of models and textures instead of the multi-gigabyte source set.
