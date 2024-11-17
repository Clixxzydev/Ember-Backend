const express = require("express");
const app = express();
const mongoose = require('mongoose');
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const error = require("./Build/structs/errorModule.js");
const id = require("./Build/structs/uuid.js");
const path = require("path");
const { spawn } = require('child_process');

dotenv.config();

const PORT = 3551;

const initializeApp = async () => {
    try {
        await generateItemshopConfig(); // Generate itemshop first
        setupDirectories();
        initializeSecret();
        cleanExpiredTokens();
        connectToMongoDB();
        setupMiddleware();
        loadRoutes();
        scheduleRestart(); 
        startServer();
    } catch (err) {
        console.error('Error initializing app:', err);
        process.exit(1); 
    }
};

  const generateItemshopConfig = async () => {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'Build' , "structs" ,'Itemshop.js');
        const child = spawn('node', [scriptPath]);

        child.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log('\x1b[33m%s\x1b[0m','itemshop generated successfully');
                resolve();
            } else {
                console.error(`Failed to generate itemshop.json (exit code ${code})`);
                reject(new Error(`Failed to generate itemshop.json (exit code ${code})`));
            }
        });
    });
}; 

const setupDirectories = () => {
    if (!fs.existsSync("./Build/ClientSettings")) fs.mkdirSync("./Build/ClientSettings");
};

const initializeSecret = () => {
    global.JWT_SECRET = id.MakeID();
};

const cleanExpiredTokens = () => {
    const tokens = JSON.parse(fs.readFileSync("./Build/token/tokens.json").toString());

    for (let tokenType in tokens) {
        tokens[tokenType] = tokens[tokenType].filter(token => {
            let decodedToken = jwt.decode(token.token.replace("eg1~", ""));
            return DateAddHours(new Date(decodedToken.creation_date), decodedToken.hours_expire).getTime() > new Date().getTime();
        });
    }

    fs.writeFileSync("./Build/token/tokens.json", JSON.stringify(tokens, null, 2));

    global.accessTokens = tokens.accessTokens;
    global.refreshTokens = tokens.refreshTokens;
    global.clientTokens = tokens.clientTokens;

    global.exchangeCodes = [];
};

async function connectToMongoDB() {
    try {
        await mongoose.connect(process.env.MONGODB_DATABASE, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB successfully');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

connectToMongoDB();

const setupMiddleware = () => {
    app.use(rateLimit({ windowMs: 0.5 * 60 * 1000, max: 45 }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
};

const loadRoutes = () => {
    const routesDir = path.join(__dirname, 'Build', 'routes');
    fs.readdirSync(routesDir).forEach(fileName => {
        const routePath = path.join(routesDir, fileName);
        const routeModule = require(routePath);
        if (typeof routeModule === 'function') {
            app.use(routeModule);
        } else {
            console.error(`Error loading route ${fileName}: expected a middleware function but got ${typeof routeModule}`);
        }
    });
};

const getTime = () => {
    const now = new Date();
    let next = new Date(now);

    next.setHours(2, 0, 0, 0); 

    if (next <= now) {
        next.setDate(now.getDate() + 1);
    }

    return next - now;
};

const scheduleRestart = () => {
    const time = getTime();

    setTimeout(() => {
        console.log('\x1b[33m%s\x1b[0m',"Restarting");
        process.exit(0);
    }, time);
};

const startServer = () => {
    app.listen(PORT, () => {
        console.log('\x1b[33m%s\x1b[0m',"EmberBackend started on port", PORT);
        require("./Build/connections/xmpp.js");
        require("./Build/discord/main.js");
    }).on("error", async (err) => {
        if (err.code == "EADDRINUSE") {
            console.log(`Port ${PORT} is already in use!\nClosing in 3 seconds...`);
            process.exit(0);
        } else throw err;
    });

    app.use((req, res, next) => {
        error.createError(
            "errors.com.epicgames.common.not_found",
            "Sorry, the resource you were trying to find could not be found",
            undefined, 1004, undefined, 404, res
        );
    });
};

const DateAddHours = (pdate, number) => {
    let date = new Date(pdate);
    date.setHours(date.getHours() + number);
    return date;
};

// Initialize the app
initializeApp();
