// Light theme styles for history view
const historyStyles = `
    html {
        scrollbar-color: var(--vscode-editor-foreground) !important;
    }

    body {
        font-family: Arial, sans-serif;
        background-color: #F5F5DC;
        color: #333333;
        height: 500px;
        margin: 0px;
    }

    body, html {
            margin: 0;
            height: 100%;
        }

        .wrapper {
            display: flex;
            flex-direction: column;
            height: 100vh;
            width: 100%;
            overflow: hidden; 
        }

        .box {
            flex-grow: 1; 
            background-color: #F5F5DC;
            display: flex;
            flex-direction: column;
            transition: height 0.05s linear;
        }

        .handler {
            height: 4px;
            background-color: #2e2e2e;
            cursor: ns-resize; 
            flex-shrink: 0;
        }

    .title {
        font-size: 26px;
        text-decoration: underline;
    }

    h1 {
        margin-bottom: 20px;
        color: #333333;
    }

    ul {
        list-style-type: none;
        padding-left: 0;
    }

    li {
        margin-bottom: 15px;
    }
    

    .editable-title {
        background-color: #ffffff;
        color: #333333;
        border: 1px solid #ccc;
        padding: 5px 10px;
        border-radius: 3px;
        margin-right: 10px;
    }

    .collapsible {
        background-color: transparent;
        color: #333333;
        cursor: pointer;
        // padding: 10px;
        border: 1px solid #ccc;
        font-size: 16px;
        border-radius: 50%;
        // margin-bottom: 5px;
    }

    .collapsible.active, .collapsible:hover {
        background-color: #dcdcdc;
    }

    .content {
        padding: 0 18px;
        display: none;
        overflow: hidden;
        background-color: #ffffff;
        border-radius: 3px;
        margin-top: 5px;
        border-left: 4px solid #007acc;
    }

    .diff-container {
        max-height: 400px;
        overflow: auto;
        border: 1px solid #ccc;

        padding: 0 18px;
        display: none;
        background-color: #ffffff;
        border-radius: 3px;
        margin-top: 5px;
    }

    a {
        color: #007acc;
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

    // reset scroll bar color
    .scrollbar {
        scrollbar-color: #ccc #f5f5f5;
    }
`;

// Light theme styles for content timeline
const contentTimelineStyles = `
    html {
        scrollbar-color: var(--vscode-editor-foreground) !important;
    }

    body {
        font-family: Arial, sans-serif;
        background-color: #f5f5f5;
        color: #333333;
    }

    .event {
        margin: 10px;
        padding: 10px;
        border: 1px solid #ccc;
        background-color: #f9f9f9;
    }

    .event-content {
        padding: 5px 0;
    }

    hr {
        border: none;
        border-top: 1px solid #ccc;
        margin: 20px 0;
    }

    a {
        color: #1e90ff;
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }
`;

module.exports = {
    historyStyles,
    contentTimelineStyles,
};