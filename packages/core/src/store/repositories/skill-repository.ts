import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { SkillIR } from '../../skill/schema.js';
import { parseSkillIR } from '../../skill/schema.js';

export function saveSkill(db: AppDatabase, ir: SkillIR): { skillId: string; version: number } {
  const now = new Date().toISOString();
  const skillId = ir.id ?? randomUUID();
  const version = ir.version;

  const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skillId) as { id: string } | undefined;

  if (!existing) {
    db.prepare('INSERT INTO skills (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(skillId, ir.name, now, now);
  } else {
    db.prepare('UPDATE skills SET name = ?, updated_at = ? WHERE id = ?').run(ir.name, now, skillId);
  }

  const versionId = randomUUID();
  const irWithId = { ...ir, id: skillId, version };
  db
    .prepare('INSERT INTO skill_versions (id, skill_id, version, ir_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(versionId, skillId, version, JSON.stringify(irWithId), now);

  return { skillId, version };
}

export function getSkill(db: AppDatabase, skillId: string, version?: number): SkillIR | null {
  const versions = db
    .prepare('SELECT version, ir_json FROM skill_versions WHERE skill_id = ?')
    .all(skillId) as Array<{ version: number; ir_json: string }>;

  if (versions.length === 0) return null;
  const target = version
    ? versions.find((v) => v.version === version)
    : versions.sort((a, b) => b.version - a.version)[0];
  if (!target) return null;
  return parseSkillIR(JSON.parse(target.ir_json));
}

export function listSkills(db: AppDatabase): Array<{ id: string; name: string; active: boolean; latestVersion: number }> {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.active, COALESCE(MAX(sv.version), 0) AS latestVersion
       FROM skills s
       LEFT JOIN skill_versions sv ON sv.skill_id = s.id
       GROUP BY s.id, s.name, s.active`,
    )
    .all() as Array<{ id: string; name: string; active: number; latestVersion: number }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    latestVersion: row.latestVersion ?? 0,
  }));
}

export function setSkillActive(db: AppDatabase, skillId: string, active: boolean) {
  db.prepare('UPDATE skills SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), skillId);
}
