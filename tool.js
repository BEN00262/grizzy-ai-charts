// simple text to chart generator using langchainjs and chartjs

require('dotenv').config({
    path: require('find-config')('.env')
});

const { z } = require("zod");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const { PromptTemplate } = require("langchain/prompts");
const { StructuredOutputParser } = require("langchain/output_parsers");
const { CSVLoader } = require("langchain/document_loaders/fs/csv");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { ConversationalRetrievalQAChain } = require("langchain/chains");
const { BufferMemory } = require("langchain/memory");
const prettify = require('html-prettify');
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const parser = StructuredOutputParser.fromZodSchema(
  z.object({
    chartType: z.enum(["line", "bar", "doughnut", "bubble", "pie", "polarArea", "radar", "scatter"]).describe("type of graph"),
    height: z.number().describe("height of the graph canvas default to 400"),
    width: z.number().describe("width of the graph canvas default to 400"),
    backgroundColour: z.string().describe("color in hexcode to use as the chart background, default to #FFFFFF"),
    data: z.object({
        labels: z.array(z.string()).describe("x axis labels"),
        datasets: z.array(
            z.object({
                label: z.string().describe("y axis label"),
                data: z.array(z.number()).describe("y axis values"),
                borderColor: z.string().describe("border color in hexcode to use for the dataset"),
                backgroundColor: z.array(z.string()).describe("an array of background colors in hexcode to use for the dataset"),
                borderWidth: z.number().describe("width of the border"),
                borderRadius: z.number().describe("border radius to use for the dataset"),
                borderSkipped: z.boolean().describe("if border for the dataset is skipped, should default to false")
            }).describe("a single dataset object")
        ).describe("an array of datasets to be used for the chart")
    }),

    options: z.object({
        indexAxis: z.enum(['x', 'y']).describe("This is used to indicate whether a chart should be horizontal or in vertical alignment, x is vertical and y is horizontal. Default to x"),
        plugins: z.object({
            legend: z.object({
                position: z.enum(["top", "bottom", "right", "left"]).describe("This is the position of the legend of the chart, default to bottom"),
            }).optional().describe("This is the title object for the chart"),
            title: z.object({
                display: z.boolean().describe("This is the flag to indicate whether to show the title or not, default to true"),
                text: z.string().describe("This is the title for the generated chart")
            }).optional().describe("This is the title object for the chart")
        }).describe("An object with the plugins to use"),

        scales: z.object({
            x: z.object({
                stacked: z.boolean().describe("Whether the x axis is stacked or not, default to false")
            }).describe("x axis scale configurations"),

            y: z.object({
                stacked: z.boolean().describe("Whether the y axis is stacked or not, default to false")
            }).describe("y axis scale configurations")
        }).describe("configuration object for the scales")
    }).describe("config options for the chart")
  })
);

class GrizzyAIChartGen {
    constructor() {
        this.model = new ChatOpenAI({ 
            temperature: 0,
            modelName: "gpt-3.5-turbo-16k",
            openAIApiKey: process.env.OPENAI_API_KEY 
        });

        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        this.prompt = new PromptTemplate({
            template:
                "Answer the users question as best as possible.\n{format_instructions}\n{question}",
            inputVariables: ["question"],
            partialVariables: { format_instructions: parser.getFormatInstructions() },
        })
    }

    generate_chartjs_code(context, backgroundColor, height, width) {
        return prettify(
            `
            <!--This code was generated by GrizzyAi chart generator (https://charts.grizzy-deploy.com)-->
        <div>
            <canvas id="myChart" height="${height}" width="${width}" style="background-color:${backgroundColor}"></canvas>
        </div>
    
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    
        <script>
            const ctx = document.getElementById('myChart');
            new Chart(ctx, ${JSON.stringify(context)});
        </script>
        `.trim()
        )
    }

    async generate_chart_from_raw_gpt_response(response) {
        const {
            chartType, height, width, 
            backgroundColour, ...graph_generated
        } = await parser.parse(response);
    
        // pass it directly and lets watch it explode :) -- seems stable tbh
        const configuration = {
            type: chartType,
            ...graph_generated
        };
    
        const chartJSNodeCanvas = new ChartJSNodeCanvas({
            width,
            height,
            backgroundColour,
        });
    
        return {
            data_url: await chartJSNodeCanvas.renderToDataURL(configuration),
            code: this.generate_chartjs_code(
                configuration, backgroundColour, 
                height, width
            )
        };
    }

    async #_generate_graph_from_description(user_prompt) {
        const input = await this.prompt.format({ question: user_prompt });
    
        return this.generate_chart_from_raw_gpt_response(
            await this.model.predict(input)
        )
    }

    async #_generic_document_loader(query, loader) {
        const documents = await loader.load();
    
        const vectorStore = await MemoryVectorStore.fromDocuments(documents, this.embeddings);

        const chain = ConversationalRetrievalQAChain.fromLLM(this.model, vectorStore.asRetriever({
            distance: 0, 
            k: 100,
        }), {
            memory: new BufferMemory({
                memoryKey: 'chat_history',
            })
        });

        const question = await this.prompt.format({ question: query });

        const response = await chain.call({ question });

        return this.generate_chart_from_raw_gpt_response(response?.text);
    }

    async generate_embeddings_and_generate_graph_from_documents(query, file) {
        if (!file) {
            return this.#_generate_graph_from_description(query)
        }

        switch (file.mimetype) {
            case 'text/csv':
                return this.#_generic_document_loader(
                    query, new CSVLoader(new Blob([file.buffer]))
                );
        }
    
        throw new Error("Unsupported file format")
    }
}

module.exports = {
    /*
        example - generate a 600 by 500 simple line chart of access to basic amenities vs occcupied private dwellings, include the title
    */
    generate_embeddings_and_generate_graph_from_documents: (prompt, file) => {
        const chart = new GrizzyAIChartGen();
        return chart.generate_embeddings_and_generate_graph_from_documents(prompt, file);
    }
 }