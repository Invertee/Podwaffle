'use strict';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'profile';
}

function parseProfiles(raw = process.env.PODWAFFLE_PROFILES) {
  const names = String(raw || 'Default')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const source = names.length ? names : ['Default'];
  const ids = new Set();

  return source.map((name) => {
    const base = slugify(name);
    let id = base;
    let suffix = 2;
    while (ids.has(id)) id = `${base.slice(0, 60)}-${suffix++}`;
    ids.add(id);
    return { id, name };
  });
}

class ProfileRegistry {
  constructor() {
    this.profiles = parseProfiles();
    this.byId = new Map(this.profiles.map((profile) => [profile.id, profile]));
  }

  list() {
    return this.profiles.map((profile) => ({ ...profile }));
  }

  get(id) {
    return this.byId.get(String(id || '').trim()) || null;
  }

  has(id) {
    return this.byId.has(String(id || '').trim());
  }

  async ensureAll(userService) {
    userService.setAllowedProfileIds?.(this.profiles.map((profile) => profile.id));
    for (const profile of this.profiles) {
      const user = await userService.ensureUser(profile.id);
      if (user.name !== profile.name) {
        user.name = profile.name;
        await userService.saveUser(user);
      }
    }
  }
}

const registry = new ProfileRegistry();
registry.parseProfiles = parseProfiles;
registry.slugify = slugify;

module.exports = registry;
