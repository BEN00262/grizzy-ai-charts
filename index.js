require('dotenv').config({
    path: require('find-config')('.env')
});

const express = require('express');
const cors = require('cors');
const multer  = require('multer');
const path = require('path');
const { rateLimit } = require('express-rate-limit');

const { generate_embeddings_and_generate_graph_from_documents } = require('./tool');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1048576 /* max 1 mb files supported */ }
});

const limiter = rateLimit({
	windowMs: 60 * 1000, // 15 minutes
	limit: 5, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
	// store: ... , // Use an external store for more precise rate limiting
})

const PORT = +process.env.PORT || 4500;
const app = express();

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// store generations kinda ( do tomorrow )
app.use(express.static(path.join(__dirname, 'build')));

// support ability to upload documents and then generate charts from them
app.post('/generate', [limiter, upload.single('file')], async (req, res) => {
    try {
        const { prompt } = req.body;

        const { data_url, code } = await generate_embeddings_and_generate_graph_from_documents(
            prompt, req?.file
        );

        // we can pass back the chartjs code by the way incase they want it
        return res.status(200).json({
            chart: data_url,
            prompt, code
        });
    } catch (error) {
        console.log(error);

        return res.status(500).json({ 
            message: "Internal server error"
        });
    }
});

app.get('*', function (req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});


app.listen(PORT, () => {
    console.log(`server started on port ${PORT}`);
})