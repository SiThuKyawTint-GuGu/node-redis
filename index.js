const express = require('express');
const mysql = require('mysql2');
const Redis = require('ioredis');
const bodyParser = require('body-parser');
const redis = new Redis();
const pub = new Redis();
const sub = new Redis();
const app = express();
sub.subscribe('taskUpdates');
app.use(bodyParser.json());

const pool = mysql.createPool({
    host: 'task-manager.c5q2s24kov9u.ap-northeast-2.rds.amazonaws.com',
    user: 'vapor',
    password: 'zsQCuhtyimKJKH97bA8ShZKr2Cboq5Ryg9jm557S',
    database: 'task_manager'
});


app.post('/tasks', async (req, res) => {
    const { title, status } = req.body;
    if (!title || !status) {
        return res.status(400).json({ error: 'Title and status are required' });
    }

    try {
        pool.query('INSERT INTO tasks (title, status) VALUES (?, ?)', [title, status], (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Error creating task' });
            }

            const taskId = results.insertId;
            const task = { id: taskId, title, status };
            redis.set(`task:${taskId}`, JSON.stringify(task));

            pub.publish('taskUpdates', JSON.stringify(task));

            res.status(201).json({ message: 'Task created successfully', task });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error creating task' });
    }
});

app.get('/tasks/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const cachedTask = await redis.get(`task:${id}`);
        if (cachedTask) {
            return res.status(200).json(JSON.parse(cachedTask));
        }

        pool.query('SELECT * FROM tasks WHERE id = ?', [id], (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Error retrieving task' });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: 'Task not found' });
            }

            const task = results[0];
            redis.set(`task:${id}`, JSON.stringify(task));

            res.status(200).json(task);
        });
    } catch (err) {
        res.status(500).json({ error: 'Error retrieving task' });
    }
});


app.delete('/tasks/:id', async (req, res) => {
    const { id } = req.params;

    try {
        pool.query('DELETE FROM tasks WHERE id = ?', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error deleting task' });
            }

            redis.del(`task:${id}`);

            res.status(200).json({ message: 'Task deleted successfully' });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting task' });
    }
});


app.get('/tasks-no-cache', (req, res) => {
    console.time('MySQL Query Time');
    pool.query('SELECT * FROM tasks', (err, results) => {
        console.timeEnd('MySQL Query Time');
        if (err) {
            return res.status(500).json({error:"Error taking tasks"})
        }
        res.status(200).json(results);
    })
})

app.get('/tasks-with-cache', async (req, res) => {
    try {
        const cachedTask = await redis.get('tasks');
        if (cachedTask) { 
            console.log('Cache Hit')
            return res.status(200).json(JSON.parse(cachedTask));
        }

        console.log('Cache Miss')
        pool.query("SELECT * FROM tasks", (err, results) => {
            if (err) {
                return res.status(500).json({error:"Error taking tasks"})
            }

            redis.set('tasks', JSON.stringify(results), 'EX', 3)
            res.status(200).json(results);
        })
    } catch (error) {
        res.status(500).json({error:"Error taking tasks"})
    }
})


// Set up Pub/Sub listener
sub.on('message', (channel, message) => {
    console.log(`Received message on ${channel}: ${message}`);
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
