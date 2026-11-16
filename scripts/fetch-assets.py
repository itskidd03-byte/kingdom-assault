#!/usr/bin/env python3
"""
Rebuild public/assets/models from the original art upload.

The game ships without binary models in git (they are large); this script pulls
the packs that were supplied for the project, keeps only the models the game
uses, and produces the compact set the renderer expects:

    public/assets/models/buildings/*.glb
    public/assets/models/characters/{elf_male,orc_male,anims}.glb
    public/assets/models/props/*.glb
    public/assets/models/nature/*.gltf + *.bin + textures

Usage:
    pip install pillow
    python3 scripts/fetch-assets.py
"""

import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

SHARE_URL = os.environ.get('KA_ASSET_SHARE_URL', 'https://quickshare.samsungcloud.com/6Pk6SD3hwv6D')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'models')
TMP = tempfile.mkdtemp(prefix='ka-assets-')
UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quickshare.samsungcloud.com/'}

BUILDINGS = {
    'building_castle_blue.glb': 'castle.glb',
    'building_A.glb': 'townhall.glb',
    'building_home_A_blue.glb': 'house_a.glb',
    'building_home_B_blue.glb': 'house_b.glb',
    'building_windmill_blue.glb': 'windmill.glb',
    'building_market_blue.glb': 'market.glb',
    'building_mine_blue.glb': 'mine.glb',
    'building_barracks_blue.glb': 'barracks.glb',
    'building_blacksmith_blue.glb': 'blacksmith.glb',
    'building_archeryrange_blue.glb': 'archery.glb',
    'building_B.glb': 'stable.glb',
    'building_church_blue.glb': 'church.glb',
    'building_tower_A_blue.glb': 'tower_a.glb',
    'building_tower_B_blue.glb': 'tower_b.glb',
    'building_tower_base_blue.glb': 'tower_base.glb',
    'building_destroyed.glb': 'ruins.glb',
    'wall_arched_gltf.glb': 'wall.glb',
    'wall_doorway.glb': 'gate.glb',
    'wall_corner_gated_gltf.glb': 'wall_corner.glb',
    'floor_dirt_large_gltf.glb': 'dirt_pad.glb',
    'floor_foundation_allsides_gltf.glb': 'foundation.glb',
}

PROPS = {
    'bedouin_tent.glb': 'tent.glb',
    'Axe_small.glb': 'axe.glb',
    'Dagger.glb': 'dagger.glb',
    'Bow_Wooden.glb': 'bow.glb',
    'Arrow_Golden.glb': 'arrow.glb',
    'ornate_war_hammer_1k.glb': 'hammer.glb',
    'ornate_medieval_mace_1k.glb': 'mace.glb',
    'bull.glb': 'bull.glb',
    'sheep.glb': 'sheep.glb',
    'pig.glb': 'pig.glb',
    'highlandcow.glb': 'cow.glb',
    'brahmachicken.glb': 'chicken.glb',
}

HEAVY_PROPS = ['tent', 'mace', 'hammer']

NATURE = ['Pine_1', 'Pine_3', 'CommonTree_2', 'DeadTree_1', 'TwistedTree_2',
          'Bush_Common', 'Rock_Medium_1', 'Rock_Medium_2', 'Pebble_Round_1', 'Fern_1']


def log(msg):
    print(f'[assets] {msg}', flush=True)


def manifest():
    log(f'reading share page {SHARE_URL}')
    req = urllib.request.Request(SHARE_URL, headers=UA)
    page = urllib.request.urlopen(req, timeout=120).read().decode('utf-8', 'replace')
    items = {}
    for chunk in page.split('{"hash":"')[1:]:
        chunk = chunk[:4000]
        url = re.search(r'"original":"([^"]+)"', chunk)
        name = re.search(r'"name":"(.*?)"', chunk)
        if url and name:
            items[html.unescape(name.group(1))] = html.unescape(url.group(1))
    log(f'{len(items)} files available')
    return items


def download(items, name):
    dest = os.path.join(TMP, name)
    if os.path.exists(dest):
        return dest
    if name not in items:
        raise SystemExit(f'missing from share: {name}')
    req = urllib.request.Request(items[name], headers=UA)
    data = urllib.request.urlopen(req, timeout=300).read()
    with open(dest, 'wb') as fh:
        fh.write(data)
    log(f'downloaded {name} ({len(data) / 1e6:.1f} MB)')
    return dest


def copy(src, dest_dir, dest_name):
    os.makedirs(dest_dir, exist_ok=True)
    shutil.copyfile(src, os.path.join(dest_dir, dest_name))


def gltf_transform(*args):
    subprocess.run(['npx', 'gltf-transform', *args], check=True,
                   cwd=ROOT, stdout=subprocess.DEVNULL)


def main():
    for sub in ('buildings', 'characters', 'props', 'nature'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    items = manifest()

    log('buildings + props')
    for src, dest in BUILDINGS.items():
        copy(download(items, src), os.path.join(OUT, 'buildings'), dest)
    for src, dest in PROPS.items():
        copy(download(items, src), os.path.join(OUT, 'props'), dest)

    log('characters')
    races = download(items, 'Characters - Fantasy Races Kit[Standard].zip')
    with zipfile.ZipFile(races) as z:
        for src, dest in (('Elf_Male.glb', 'elf_male.glb'), ('Orc_Male.glb', 'orc_male.glb')):
            member = next(n for n in z.namelist() if n.endswith(src))
            with z.open(member) as fh, open(os.path.join(TMP, dest), 'wb') as out:
                shutil.copyfileobj(fh, out)
            small = os.path.join(TMP, 'small_' + dest)
            gltf_transform('resize', '--width', '512', '--height', '512',
                           os.path.join(TMP, dest), small)
            gltf_transform('webp', '--slots', 'baseColor', '--quality', '82',
                           small, os.path.join(OUT, 'characters', dest))

    log('animation clips')
    animations = download(items, 'Universal Animation Library[Standard].zip')
    with zipfile.ZipFile(animations) as z:
        member = next(n for n in z.namelist() if n.endswith('UAL1_Standard.glb'))
        with z.open(member) as fh, open(os.path.join(TMP, 'ual1.glb'), 'wb') as out:
            shutil.copyfileobj(fh, out)
    subprocess.run(['node', 'scripts/extract-anims.mjs', os.path.join(TMP, 'ual1.glb'),
                    os.path.join(OUT, 'characters', 'anims.glb')], check=True, cwd=ROOT)

    log('nature')
    nature = download(items, 'Stylized Nature MegaKit[Standard].zip')
    with zipfile.ZipFile(nature) as z:
        names = set(z.namelist())
        wanted = set()
        for model in NATURE:
            for ext in ('.gltf', '.bin'):
                src = f'glTF/{model}{ext}'
                if src not in names:
                    continue
                with z.open(src) as fh, open(os.path.join(OUT, 'nature', os.path.basename(src)), 'wb') as out:
                    shutil.copyfileobj(fh, out)
            with z.open(f'glTF/{model}.gltf') as fh:
                doc = json.load(fh)
            for img in doc.get('images', []):
                uri = img.get('uri', '')
                if uri and not uri.startswith('data:'):
                    wanted.add(uri)
        for tex in sorted(wanted):
            match = next((n for n in names if n.endswith('/' + tex)), None)
            if not match:
                continue
            with z.open(match) as fh, open(os.path.join(OUT, 'nature', tex), 'wb') as out:
                shutil.copyfileobj(fh, out)

    try:
        from PIL import Image
        for tex in os.listdir(os.path.join(OUT, 'nature')):
            if not tex.lower().endswith('.png'):
                continue
            path = os.path.join(OUT, 'nature', tex)
            im = Image.open(path)
            if max(im.size) > 256:
                im = im.resize((256, 256), Image.LANCZOS)
            im.save(path, optimize=True)
        log('nature textures resized')
    except ImportError:
        log('pillow not installed — keeping original texture sizes')

    log('done: ' + OUT)


if __name__ == '__main__':
    sys.exit(main())
