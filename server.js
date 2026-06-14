const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES = '24h';

// ─── Middleware ─────────────────────────────────────────────────────────────

function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ─── DB Init ─────────────────────────────────────────────────────────────────

async function initDB() {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(schema);

  // Create default admin if no users exist
  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (rows[0].count === '0') {
    const hash = await bcrypt.hash('admin123', 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)`,
      ['admin', hash, 'System Administrator', 'admin']
    );
    console.log('Default admin created: admin / admin123');
  }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const { rows } = await pool.query(
      'SELECT u.*, d.name as dept_name FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.username = $1 AND u.is_active = true',
      [username]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, department_id: user.department_id, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    await pool.query(
      `INSERT INTO activity_log (user_id, action, entity_type) VALUES ($1, 'login', 'user')`,
      [user.id]
    );

    res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, department_id: user.department_id, dept_name: user.dept_name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.is_active, u.created_at, d.name as dept_name FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Department Routes ────────────────────────────────────────────────────────

app.get('/api/departments', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, COUNT(DISTINCT u.id) as member_count
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      GROUP BY d.id ORDER BY d.name
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/departments', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query('INSERT INTO departments (name, description) VALUES ($1,$2) RETURNING *', [name, description]);
    await logActivity(req.user.id, 'create_department', 'department', rows[0].id, name);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/departments/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const { rows } = await pool.query('UPDATE departments SET name=$1, description=$2 WHERE id=$3 RETURNING *', [name, description, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logActivity(req.user.id, 'update_department', 'department', rows[0].id, name);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/departments/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM departments WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logActivity(req.user.id, 'delete_department', 'department', req.params.id, rows[0].name);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── User Routes ──────────────────────────────────────────────────────────────

app.get('/api/users', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    let query = `SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.is_active, u.created_at, d.name as dept_name
                 FROM users u LEFT JOIN departments d ON u.department_id = d.id`;
    const params = [];
    if (req.user.role === 'manager') {
      query += ' WHERE u.department_id = $1';
      params.push(req.user.department_id);
    }
    query += ' ORDER BY u.full_name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, full_name, role, department_id } = req.body;
    if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'Missing required fields' });
    if (!['admin','manager','member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role, department_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, role, department_id',
      [username, hash, full_name, role, department_id || null]
    );
    await logActivity(req.user.id, 'create_user', 'user', rows[0].id, full_name, { role, department_id });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { full_name, role, department_id, is_active, password } = req.body;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    }
    const { rows } = await pool.query(
      'UPDATE users SET full_name=COALESCE($1,full_name), role=COALESCE($2,role), department_id=$3, is_active=COALESCE($4,is_active), updated_at=NOW() WHERE id=$5 RETURNING id, username, full_name, role, department_id, is_active',
      [full_name, role, department_id || null, is_active !== undefined ? is_active : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logActivity(req.user.id, 'update_user', 'user', rows[0].id, rows[0].full_name);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await pool.query('UPDATE users SET is_active=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Project Routes ───────────────────────────────────────────────────────────

app.get('/api/projects', authRequired, async (req, res) => {
  try {
    let query = `
      SELECT p.*, d.name as dept_name, u.full_name as created_by_name,
        COALESCE(json_agg(DISTINCT jsonb_build_object('user_id', pm.user_id, 'full_name', mu.full_name, 'can_edit', pm.can_edit)) FILTER (WHERE pm.user_id IS NOT NULL), '[]') as members,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', m.id, 'label', m.label, 'target_date', m.target_date, 'is_completed', m.is_completed)) FILTER (WHERE m.id IS NOT NULL), '[]') as milestones,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', pl.id, 'label', pl.label, 'url', pl.url)) FILTER (WHERE pl.id IS NOT NULL), '[]') as links
      FROM projects p
      LEFT JOIN departments d ON p.department_id = d.id
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN users mu ON mu.id = pm.user_id
      LEFT JOIN milestones m ON m.project_id = p.id
      LEFT JOIN project_links pl ON pl.project_id = p.id
    `;
    const params = [];
    if (req.user.role === 'manager') {
      query += ' WHERE p.department_id = $1';
      params.push(req.user.department_id);
    } else if (req.user.role === 'member') {
      query += ' WHERE (pm.user_id = $1 OR p.created_by = $1)';
      params.push(req.user.id);
    }
    query += ' GROUP BY p.id, d.name, u.full_name ORDER BY p.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/projects', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { name, description, department_id, category, priority, status, plan_start, plan_end, plan_target, pic, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name required' });

    // Manager can only create in their department
    const deptId = req.user.role === 'manager' ? req.user.department_id : (department_id || null);

    const { rows } = await pool.query(
      `INSERT INTO projects (name, description, department_id, category, priority, status, plan_start, plan_end, plan_target, pic, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, description, deptId, category, priority || 'Medium', status || 'On Track', plan_start, plan_end, plan_target || 0, pic, notes, req.user.id]
    );
    await logActivity(req.user.id, 'create_project', 'project', rows[0].id, name);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/projects/:id', authRequired, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);

    // Check permissions
    const { rows: pRows } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!pRows.length) return res.status(404).json({ error: 'Project not found' });
    const project = pRows[0];

    if (req.user.role === 'member') {
      // Members can only update progress on assigned projects
      const { rows: aRows } = await pool.query('SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2 AND can_edit=true', [projectId, req.user.id]);
      if (!aRows.length) return res.status(403).json({ error: 'Not assigned to this project' });

      // Members can only update progress, status, rag, notes
      const { actual_progress, status, rag, notes } = req.body;

      await pool.query(
        'UPDATE projects SET actual_progress=COALESCE($1,actual_progress), status=COALESCE($2,status), rag=COALESCE($3,rag), notes=COALESCE($4,notes), updated_at=NOW() WHERE id=$5',
        [actual_progress, status, rag, notes, projectId]
      );

      // Log progress update
      await pool.query(
        'INSERT INTO project_updates (project_id, user_id, old_progress, new_progress, old_status, new_status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [projectId, req.user.id, project.actual_progress, actual_progress ?? project.actual_progress, project.status, status ?? project.status, notes]
      );

      // Notify project creator
      if (project.created_by && project.created_by !== req.user.id) {
        await createNotification(project.created_by, 'progress_update', `Progress Update: ${project.name}`,
          `${req.user.full_name} updated progress to ${actual_progress ?? project.actual_progress}%`, `/projects/${projectId}`);
      }

      return res.json({ message: 'Progress updated' });
    }

    // Admin/manager can update everything
    if (req.user.role === 'manager' && project.department_id !== req.user.department_id) {
      return res.status(403).json({ error: 'Cannot edit projects from other departments' });
    }

    const { name, description, department_id, category, priority, status, rag, plan_start, plan_end, plan_target, actual_progress, pic, notes } = req.body;

    const { rows } = await pool.query(
      `UPDATE projects SET name=COALESCE($1,name), description=COALESCE($2,description), department_id=COALESCE($3,department_id),
       category=COALESCE($4,category), priority=COALESCE($5,priority), status=COALESCE($6,status), rag=COALESCE($7,rag),
       plan_start=COALESCE($8,plan_start), plan_end=COALESCE($9,plan_end), plan_target=COALESCE($10,plan_target),
       actual_progress=COALESCE($11,actual_progress), pic=COALESCE($12,pic), notes=COALESCE($13,notes), updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [name, description, req.user.role === 'manager' ? project.department_id : (department_id || project.department_id),
       category, priority, status, rag, plan_start, plan_end, plan_target, actual_progress, pic, notes, projectId]
    );

    await logActivity(req.user.id, 'update_project', 'project', projectId, rows[0].name);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/projects/:id', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'manager' && rows[0].department_id !== req.user.department_id) {
      return res.status(403).json({ error: 'Cannot delete projects from other departments' });
    }
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    await logActivity(req.user.id, 'delete_project', 'project', req.params.id, rows[0].name);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Project Members (Assignment) ─────────────────────────────────────────────

app.get('/api/projects/:id/members', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pm.*, u.full_name, u.username, u.role FROM project_members pm
       JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/projects/:id/members', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { user_id, can_edit } = req.body;
    const projectId = parseInt(req.params.id);

    if (req.user.role === 'manager') {
      const { rows: pRows } = await pool.query('SELECT department_id FROM projects WHERE id=$1', [projectId]);
      if (!pRows.length || pRows[0].department_id !== req.user.department_id) {
        return res.status(403).json({ error: 'Can only assign members to your department projects' });
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO project_members (project_id, user_id, can_edit, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, user_id) DO UPDATE SET can_edit=$3 RETURNING *',
      [projectId, user_id, can_edit !== false, req.user.id]
    );

    // Get user and project info for notification
    const { rows: uRows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [user_id]);
    const { rows: prRows } = await pool.query('SELECT name FROM projects WHERE id=$1', [projectId]);

    await createNotification(user_id, 'assigned', `Assigned to Project`,
      `You have been assigned to project: ${prRows[0]?.name}`, `/projects/${projectId}`);
    await logActivity(req.user.id, 'assign_member', 'project', projectId, prRows[0]?.name, { assigned_user: uRows[0]?.full_name });

    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/projects/:id/members/:userId', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
    res.json({ message: 'Member removed' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Comments ─────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/comments', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT c.*, u.full_name, u.username FROM project_comments c JOIN users u ON u.id = c.user_id WHERE c.project_id=$1 ORDER BY c.created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/projects/:id/comments', authRequired, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    const { rows } = await pool.query(
      'INSERT INTO project_comments (project_id, user_id, content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, content]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/projects/:id/comments/:commentId', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT user_id FROM project_comments WHERE id=$1', [req.params.commentId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id && req.user.role === 'member') return res.status(403).json({ error: 'Cannot delete others comments' });
    await pool.query('DELETE FROM project_comments WHERE id=$1', [req.params.commentId]);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Milestones ────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/milestones', authRequired, async (req, res) => {
  try {
    const { label, target_date } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO milestones (project_id, label, target_date) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, label, target_date]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/milestones/:id', authRequired, async (req, res) => {
  try {
    const { label, target_date, is_completed } = req.body;
    const { rows } = await pool.query(
      'UPDATE milestones SET label=COALESCE($1,label), target_date=COALESCE($2,target_date), is_completed=COALESCE($3,is_completed) WHERE id=$4 RETURNING *',
      [label, target_date, is_completed, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/milestones/:id', authRequired, async (req, res) => {
  try {
    await pool.query('DELETE FROM milestones WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Links ─────────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/links', authRequired, async (req, res) => {
  try {
    const { label, url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const { rows } = await pool.query('INSERT INTO project_links (project_id, label, url) VALUES ($1,$2,$3) RETURNING *', [req.params.id, label, url]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/links/:id', authRequired, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_links WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Progress History ─────────────────────────────────────────────────────────

app.get('/api/projects/:id/updates', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT pu.*, u.full_name FROM project_updates pu LEFT JOIN users u ON u.id = pu.user_id WHERE pu.project_id=$1 ORDER BY pu.created_at DESC LIMIT 50',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Notifications ─────────────────────────────────────────────────────────────

// Throttle: only run generateReminders once per hour across all requests
let _lastReminderCheck = 0;
app.get('/api/notifications', authRequired, async (req, res) => {
  try {
    const now = Date.now();
    if (now - _lastReminderCheck > 60 * 60 * 1000) {
      _lastReminderCheck = now;
      generateReminders().catch(e => console.error('reminder bg error:', e.message));
    }
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/notifications/read-all', authRequired, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]);
    res.json({ message: 'All marked as read' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/notifications/:id/read', authRequired, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Marked as read' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Activity Log ──────────────────────────────────────────────────────────────

app.get('/api/activity', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    let query = `SELECT al.*, u.full_name FROM activity_log al LEFT JOIN users u ON u.id = al.user_id`;
    const params = [];
    if (req.user.role === 'manager') {
      // Only show activities related to their department's projects
      query += ` WHERE al.entity_type = 'project' AND al.entity_id IN (SELECT id FROM projects WHERE department_id=$1)`;
      params.push(req.user.department_id);
    }
    query += ' ORDER BY al.created_at DESC LIMIT 100';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

app.get('/api/stats', authRequired, async (req, res) => {
  try {
    let whereClause = '';
    const params = [];
    if (req.user.role === 'manager') {
      whereClause = 'WHERE p.department_id = $1';
      params.push(req.user.department_id);
    } else if (req.user.role === 'member') {
      whereClause = 'WHERE pm.user_id = $1';
      params.push(req.user.id);
    }

    const q = `
      SELECT
        COUNT(DISTINCT p.id) as total_projects,
        COUNT(DISTINCT CASE WHEN p.status='Done' THEN p.id END) as done,
        COUNT(DISTINCT CASE WHEN p.status='On Track' THEN p.id END) as on_track,
        COUNT(DISTINCT CASE WHEN p.status='Warning' THEN p.id END) as warning,
        COUNT(DISTINCT CASE WHEN p.status='Critical' THEN p.id END) as critical,
        ROUND(AVG(p.actual_progress)) as avg_progress
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
      ${whereClause}
    `;
    const { rows } = await pool.query(q, params);
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Dashboard state endpoints (main dashboard JSONB) ────────────────────────

app.get('/api/state', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM dashboard_state WHERE id=1');
    let state;
    if (!rows.length) {
      try {
        const fs = require('fs');
        state = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_projects_dpcd.json'), 'utf8'));
      } catch {
        return res.json(null);
      }
    } else {
      state = rows[0].data;
    }

    // Backend role filter: manager/member only see their dept's projects
    const { role, dept_name } = req.user;
    if ((role === 'manager' || role === 'member') && dept_name && state && Array.isArray(state.projects)) {
      state = {
        ...state,
        projects: state.projects.filter(p => (p.department || '') === dept_name)
      };
    }

    res.json(state);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/state', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const data = req.body;
    const editorName = req.user.full_name;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO dashboard_state (id, data, updated_at, updated_by) VALUES (1, $1, NOW(), $2)
         ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=NOW(), updated_by=$2 RETURNING updated_at`,
        [JSON.stringify(data), editorName]
      );
      await client.query(
        'INSERT INTO dashboard_revisions (data, saved_by) VALUES ($1, $2)',
        [JSON.stringify(data), editorName]
      );
      await client.query('COMMIT');
      await logActivity(req.user.id, 'save_dashboard', 'dashboard', 1, 'Dashboard State');
      res.json({ data, updatedAt: rows[0].updated_at, updatedBy: editorName });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/state/revisions', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, saved_by, created_at FROM dashboard_revisions ORDER BY created_at DESC LIMIT 50'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Project Assignments ─────────────────────────────────────────────────────

// Member create project — appends project to JSONB and auto-assigns to self
app.post('/api/state/project', authRequired, async (req, res) => {
  try {
    const { project } = req.body;
    if (!project || !project.name) return res.status(400).json({ error: 'Project name required' });

    // Force dept to user's own dept for member/manager
    if (req.user.role === 'member' || req.user.role === 'manager') {
      project.department = req.user.dept_name || project.department || '';
    }

    const projId = project.id || ('proj_' + Date.now());
    project.id = projId;

    const { rows } = await pool.query('SELECT data FROM dashboard_state WHERE id=1');
    const state = rows.length ? rows[0].data : { projects: [] };
    if (!state.projects) state.projects = [];
    state.projects.push(project);

    await pool.query(
      `INSERT INTO dashboard_state (id, data, updated_at, updated_by) VALUES (1, $1, NOW(), $2)
       ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=NOW(), updated_by=$2`,
      [JSON.stringify(state), req.user.full_name]
    );

    // Auto-assign to creator
    await pool.query(
      `INSERT INTO project_assignments (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [projId, req.user.id]
    );

    await logActivity(req.user.id, 'create_project', 'project', projId, project.name);
    res.json({ project, projectId: projId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Member progress update — patches a single project inside dashboard_state JSONB
app.patch('/api/state/project/:projectId', authRequired, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { actual_progress, status, rag, notes, blockers } = req.body;
    const userId = req.user.id;

    // Admin/manager can patch directly. Members must be assigned.
    if (req.user.role === 'member') {
      const { rows: aRows } = await pool.query(
        'SELECT 1 FROM project_assignments WHERE project_id=$1 AND user_id=$2',
        [projectId, userId]
      );
      if (!aRows.length) return res.status(403).json({ error: 'Tidak memiliki akses ke proyek ini' });
    }

    // Load current state
    const { rows } = await pool.query('SELECT data FROM dashboard_state WHERE id=1');
    if (!rows.length) return res.status(404).json({ error: 'Dashboard state not found' });

    const state = rows[0].data;
    const projects = (state.projects || []);
    const idx = projects.findIndex(p => String(p.id) === String(projectId));
    if (idx === -1) return res.status(404).json({ error: 'Project not found' });

    // Apply updates
    if (actual_progress !== undefined) projects[idx].actualProgress = actual_progress;
    if (status !== undefined) projects[idx].status = status;
    if (rag !== undefined) projects[idx].rag = rag;
    if (notes !== undefined) projects[idx].notes = notes;
    if (blockers !== undefined) projects[idx].blockers = blockers;

    state.projects = projects;

    await pool.query(
      `UPDATE dashboard_state SET data=$1, updated_at=NOW(), updated_by=$2 WHERE id=1`,
      [JSON.stringify(state), req.user.full_name]
    );

    await logActivity(req.user.id, 'update_project_progress', 'project', projectId, projects[idx].name, {
      actual_progress, status
    });

    res.json({ message: 'Progress updated', project: projects[idx] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get assignments for current user
app.get('/api/my-assignments', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT project_id FROM project_assignments WHERE user_id=$1',
      [req.user.id]
    );
    res.json(rows.map(r => r.project_id));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all assignments (admin/manager)
app.get('/api/assignments', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pa.*, u.full_name, u.username FROM project_assignments pa JOIN users u ON u.id = pa.user_id ORDER BY pa.project_id`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign user to project
app.post('/api/assignments', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { project_id, user_id } = req.body;
    if (!project_id || !user_id) return res.status(400).json({ error: 'project_id and user_id required' });
    await pool.query(
      'INSERT INTO project_assignments (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [String(project_id), user_id]
    );
    const { rows: uRows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [user_id]);
    await createNotification(user_id, 'assigned', 'Di-assign ke Proyek',
      `Anda di-assign ke proyek ID: ${project_id}`, '/');
    await logActivity(req.user.id, 'assign_member', 'project', project_id, String(project_id), { assigned_user: uRows[0]?.full_name });
    res.status(201).json({ message: 'Assigned' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove assignment
app.delete('/api/assignments/:projectId/:userId', authRequired, requireRole('admin', 'manager'), async (req, res) => {
  try {
    await pool.query('DELETE FROM project_assignments WHERE project_id=$1 AND user_id=$2',
      [req.params.projectId, req.params.userId]);
    res.json({ message: 'Assignment removed' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── Catch-all for SPA ────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logActivity(userId, action, entityType, entityId, entityName, details) {
  try {
    await pool.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, entity_name, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, action, entityType, entityId, entityName, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
}

async function createNotification(userId, type, title, message, link) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, title, message, link]
    );
  } catch (e) {
    console.error('Notification error:', e.message);
  }
}

// Dedup check: avoid sending same reminder twice on same day
async function reminderAlreadySent(userId, type, refKey) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notifications WHERE user_id=$1 AND type=$2 AND title LIKE $3
     AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day' LIMIT 1`,
    [userId, type, '%' + refKey + '%']
  );
  return rows.length > 0;
}

// Generate H-1 reminders for calendar events and project deadlines
async function generateReminders() {
  try {
    // Tomorrow's date in WIB (UTC+7), stored as YYYY-MM-DD
    const tomorrow = new Date();
    tomorrow.setUTCHours(tomorrow.getUTCHours() + 7); // shift to WIB
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // --- 1. Calendar Event H-1 ---
    const stateRes = await pool.query('SELECT data FROM dashboard_state WHERE id=1');
    if (stateRes.rows.length > 0) {
      const state = stateRes.rows[0].data;
      const events = (state.meta && Array.isArray(state.meta.events)) ? state.meta.events : [];

      // Get all active users with their roles and departments
      const { rows: users } = await pool.query(
        `SELECT u.id, u.full_name, u.role, d.name as dept_name
         FROM users u LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.is_active = true`
      );

      for (const ev of events) {
        const evStart = ev.startDate || ev.date;
        if (!evStart || evStart !== tomorrowStr) continue;

        const evName = ev.name || 'Kegiatan';
        const evPic = (ev.pic || '').toLowerCase().trim();
        const timeLabel = ev.startTime ? ` pukul ${ev.startTime}` : '';
        const title = `⏰ Pengingat: ${evName}`;
        const message = `Kegiatan "${evName}" akan berlangsung besok${timeLabel}. PIC: ${ev.pic || '-'}`;

        for (const user of users) {
          const isPic = evPic && user.full_name.toLowerCase().includes(evPic);
          const isAdmin = user.role === 'admin';
          // Manager: gets reminders for events in their dept (dept matches event pic dept)
          const isManager = user.role === 'manager';
          // Member: only if they are the PIC
          const isMember = user.role === 'member';

          let shouldNotify = false;
          if (isAdmin) shouldNotify = true;
          else if (isPic) shouldNotify = true;
          else if (isManager) shouldNotify = true; // managers see all calendar reminders
          // members only if they are PIC

          if (!shouldNotify) continue;

          const refKey = `${evName}_${tomorrowStr}`;
          const alreadySent = await reminderAlreadySent(user.id, 'calendar_reminder', refKey);
          if (!alreadySent) {
            await createNotification(user.id, 'calendar_reminder', title, message, null);
          }
        }
      }
    }

    // --- 2. Project Deadline H-1 ---
    // Check projects stored in dashboard_state projects array
    const stateRes2 = await pool.query('SELECT data FROM dashboard_state WHERE id=1');
    if (stateRes2.rows.length > 0) {
      const state = stateRes2.rows[0].data;
      const projects = Array.isArray(state.projects) ? state.projects : [];

      const { rows: users } = await pool.query(
        `SELECT u.id, u.full_name, u.role, d.name as dept_name
         FROM users u LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.is_active = true`
      );

      // Also get DB projects with members
      const { rows: dbProjects } = await pool.query(
        `SELECT p.id, p.name, p.plan_end, p.department_id, d.name as dept_name,
                array_agg(pm.user_id) FILTER (WHERE pm.user_id IS NOT NULL) as member_ids
         FROM projects p
         LEFT JOIN departments d ON p.department_id = d.id
         LEFT JOIN project_members pm ON pm.project_id = p.id
         WHERE p.plan_end::date = $1
         GROUP BY p.id, p.name, p.plan_end, p.department_id, d.name`,
        [tomorrowStr]
      );

      for (const proj of dbProjects) {
        const title = `📅 Deadline Besok: ${proj.name}`;
        const message = `Proyek "${proj.name}" memiliki deadline rencana pada besok (${tomorrowStr}). Departemen: ${proj.dept_name || '-'}`;
        const memberIds = proj.member_ids || [];

        for (const user of users) {
          const isAdmin = user.role === 'admin';
          const isManagerSameDept = user.role === 'manager' && user.dept_name === proj.dept_name;
          const isMemberAssigned = memberIds.includes(user.id);

          if (!isAdmin && !isManagerSameDept && !isMemberAssigned) continue;

          const refKey = `${proj.name}_${tomorrowStr}`;
          const alreadySent = await reminderAlreadySent(user.id, 'deadline_reminder', refKey);
          if (!alreadySent) {
            await createNotification(user.id, 'deadline_reminder', title, message, null);
          }
        }
      }
    }
  } catch (e) {
    console.error('generateReminders error:', e.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

pool.connect()
  .then(() => initDB())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // Run first reminder check 5s after boot
      setTimeout(() => generateReminders().catch(e => console.error('boot reminder error:', e.message)), 5000);
    });
  })
  .catch(err => {
    console.error('Failed to connect to database:', err.message);
    // Start anyway for static serving
    app.listen(PORT, () => console.log(`Server running on port ${PORT} (no DB)`));
  });
