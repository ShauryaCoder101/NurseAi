// Dashboard Controller
const {dbHelpers} = require('../config/database');

// Get dashboard summary
async function getDashboardSummary(req, res) {
  try {
    const userId = req.userId;

    // Gemini suggestion counts (pending vs completed)
    const pendingResult = await dbHelpers.get(
      `SELECT COUNT(*)::int as count
       FROM transcripts
       WHERE user_uid = $1 AND suggestion_completed = FALSE`,
      [userId]
    );

    const doneResult = await dbHelpers.get(
      `SELECT COUNT(*)::int as count
       FROM transcripts
       WHERE user_uid = $1 AND suggestion_completed = TRUE`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        pending: parseInt(pendingResult?.count) || 0,
        done: parseInt(doneResult?.count) || 0,
      },
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Get patient tasks
async function getPatientTasks(req, res) {
  try {
    const userId = req.userId;
    const {sortBy = 'emergency', patientName, patientId, status} = req.query;

    // Build query with optional filters
    let query = 'SELECT * FROM patient_tasks WHERE user_uid = $1';
    const params = [userId];
    let paramIndex = 2;

    if (patientName) {
      query += ` AND LOWER(patient_name) = LOWER($${paramIndex})`;
      params.push(patientName.trim());
      paramIndex++;
    }

    if (patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(patientId.trim());
      paramIndex++;
    }

    if (status && status.toLowerCase() !== 'all') {
      const normalizedStatus = status.trim().toLowerCase();
      if (normalizedStatus === 'done' || normalizedStatus === 'completed') {
        query += ` AND LOWER(status) IN ($${paramIndex}, $${paramIndex + 1})`;
        params.push('done', 'completed');
        paramIndex += 2;
      } else {
        query += ` AND LOWER(status) = $${paramIndex}`;
        params.push(normalizedStatus);
        paramIndex++;
      }
    }

    let orderBy = 'created_at DESC';
    if (sortBy === 'emergency') {
      orderBy = `
        CASE 
          WHEN emergency_level = 'HIGH' THEN 1
          WHEN emergency_level = 'MEDIUM' THEN 2
          WHEN emergency_level = 'LOW' THEN 3
          ELSE 4
        END,
        scheduled_time ASC
      `;
    }

    query += ` ORDER BY ${orderBy}`;

    const tasks = await dbHelpers.all(query, params);

    // Format tasks
    const formattedTasks = tasks.map((task) => ({
      id: task.id,
      patientName: task.patient_name,
      patientId: task.patient_id,
      taskDescription: task.task_description,
      scheduledTime: task.scheduled_time,
      emergencyLevel: task.emergency_level,
      status: task.status,
    }));

    res.json({
      success: true,
      data: formattedTasks,
    });
  } catch (error) {
    console.error('Get patient tasks error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Mark patient task as completed
async function completePatientTask(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required.',
      });
    }

    const result = await dbHelpers.query(
      `UPDATE patient_tasks
       SET status = 'Done', updated_at = NOW()
       WHERE id = $1 AND user_uid = $2
       RETURNING id, status`,
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Complete patient task error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

module.exports = {
  getDashboardSummary,
  getPatientTasks,
  completePatientTask,
};
