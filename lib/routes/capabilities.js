/**
 * Claude CLI capabilities scanning (skills, commands, agents)
 */
const path = require('path');
const fsp = require('fs').promises;

/**
 * Parse YAML frontmatter from a markdown file.
 * @param {string} content - File content
 * @returns {Object} - Parsed key-value pairs from frontmatter
 */
function parseYamlFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

/**
 * Scan for skills (SKILL.md files with name + description in frontmatter)
 * @param {string} basePath - Directory to scan
 * @param {string} source - Source identifier ('global' or 'project')
 * @returns {Promise<Array>} - Array of skill objects
 */
async function scanSkills(basePath, source) {
  const skills = [];
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(basePath, entry.name, 'SKILL.md');
      try {
        const content = await fsp.readFile(skillPath, 'utf-8');
        const meta = parseYamlFrontmatter(content);
        if (meta.name || meta.description) {
          skills.push({
            name: meta.name || entry.name,
            description: meta.description || '',
            source,
          });
        }
      } catch {
        // No SKILL.md or can't read it
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return skills;
}

/**
 * Scan for commands (.md files with description in frontmatter)
 * @param {string} basePath - Directory to scan
 * @param {string} source - Source identifier
 * @returns {Promise<Array>} - Array of command objects
 */
async function scanCommands(basePath, source) {
  const commands = [];
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const cmdPath = path.join(basePath, entry.name);
      try {
        const content = await fsp.readFile(cmdPath, 'utf-8');
        const meta = parseYamlFrontmatter(content);
        const cmdName = entry.name.replace(/\.md$/, '');
        commands.push({
          name: cmdName,
          description: meta.description || '',
          source,
        });
      } catch {
        // Can't read file
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return commands;
}

/**
 * Scan for agents (.md files in agents/ directories)
 * @param {string} basePath - Directory to scan
 * @param {string} source - Source identifier
 * @returns {Promise<Array>} - Array of agent objects
 */
async function scanAgents(basePath, source) {
  const agents = [];
  try {
    const entries = await fsp.readdir(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const agentPath = path.join(basePath, entry.name);
      try {
        const content = await fsp.readFile(agentPath, 'utf-8');
        const meta = parseYamlFrontmatter(content);
        const agentName = entry.name.replace(/\.md$/, '');
        agents.push({
          name: agentName,
          description: meta.description || '',
          source,
        });
      } catch {
        // Can't read file
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return agents;
}

/**
 * Scan plugins directory for skills, commands, and agents
 * @param {string} pluginsPath - Plugins directory
 * @returns {Promise<{skills: Array, commands: Array, agents: Array}>}
 */
async function scanPlugins(pluginsPath) {
  const skills = [];
  const commands = [];
  const agents = [];

  try {
    const plugins = await fsp.readdir(pluginsPath, { withFileTypes: true });
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const pluginPath = path.join(pluginsPath, plugin.name);

      const pluginSkillsPath = path.join(pluginPath, 'skills');
      skills.push(...await scanSkills(pluginSkillsPath, 'global'));

      const pluginCmdsPath = path.join(pluginPath, 'commands');
      commands.push(...await scanCommands(pluginCmdsPath, 'global'));

      const pluginAgentsPath = path.join(pluginPath, 'agents');
      agents.push(...await scanAgents(pluginAgentsPath, 'global'));
    }
  } catch {
    // Plugins directory doesn't exist
  }

  return { skills, commands, agents };
}

function setupCapabilitiesRoutes(app) {
  // Get Claude CLI capabilities
  app.get('/api/capabilities', async (req, res) => {
    const cwd = req.query.cwd || process.env.HOME;
    const home = process.env.HOME;

    let skills = [];
    let commands = [];
    let agents = [];

    // Global: ~/.claude/skills/
    const globalSkillsPath = path.join(home, '.claude', 'skills');
    skills.push(...await scanSkills(globalSkillsPath, 'global'));

    // Global: ~/.claude/agents/
    const globalAgentsPath = path.join(home, '.claude', 'agents');
    agents.push(...await scanAgents(globalAgentsPath, 'global'));

    // Global: ~/.claude/plugins/**/
    const globalPluginsPath = path.join(home, '.claude', 'plugins');
    const pluginResults = await scanPlugins(globalPluginsPath);
    skills.push(...pluginResults.skills);
    commands.push(...pluginResults.commands);
    agents.push(...pluginResults.agents);

    // Project: {cwd}/.claude/skills/
    const projectSkillsPath = path.join(cwd, '.claude', 'skills');
    skills.push(...await scanSkills(projectSkillsPath, 'project'));

    // Project: {cwd}/.claude/commands/
    const projectCmdsPath = path.join(cwd, '.claude', 'commands');
    commands.push(...await scanCommands(projectCmdsPath, 'project'));

    // Project: {cwd}/.claude/agents/
    const projectAgentsPath = path.join(cwd, '.claude', 'agents');
    agents.push(...await scanAgents(projectAgentsPath, 'project'));

    // Deduplicate by name (project takes precedence)
    const dedup = (arr) => {
      const seen = new Map();
      for (const item of arr) {
        const existing = seen.get(item.name);
        if (!existing || item.source === 'project') {
          seen.set(item.name, item);
        }
      }
      return Array.from(seen.values());
    };

    res.json({
      skills: dedup(skills),
      commands: dedup(commands),
      agents: dedup(agents),
    });
  });
}

module.exports = { setupCapabilitiesRoutes };
