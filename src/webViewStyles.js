// Light theme styles for history view
const historyStyles = `
    html {
        scrollbar-color: var(--vscode-editor-foreground) !important;
    }

    body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
        // background-image: url("C:\Users\zhouh\OneDrive\Documents\GitHub\codeHistories\paper background.jpg");
        color: #333333;
        height: auto;
        margin: 0px;
    }

    body, html {
        margin: 0;
    }

    .wrapper {
        display: flex;
        flex-direction: column;
        // height: 100vh;
        width: 100%;
    }

    .box {
        flex-grow: 1; 
        display: flex;
        flex-direction: column;
        transition: height 0.05s linear;
        overflow: scroll;
    }

    .tooltip {
        position: relative;
        display: inline-block;
        // border-bottom: 1px dotted black;
        width: fit-content;
    }

    .tooltip .tooltiptext {
        visibility: hidden;
        width: 260px;
        background-color: black;
        color: #fff;
        text-align: center;
        border-radius: 6px;
        padding: 5px 0;
        
        /* Position the tooltip */
        position: absolute;
        z-index: 1;
        top: 15px;
        left: 105%;
    }

    .tooltip:hover .tooltiptext {
        visibility: visible;
    }

    #upper{
        height: 50vh;
    }

    #lower{
        z-index: 999;
        position: relative;
        top: 50%;          / Starts at 50% height of the viewport /
        left: 0;           / Starts at the left side of the screen /
    }

    .handler {
        height: 6px;
        background-color: #2e2e2e;
        cursor: ns-resize; 
        flex-shrink: 0;
    }
    
    h4{
        top: 25px;
        margin: 0;
    }

    .title {
        font-size: 26px;
        text-decoration: underline;
    }

    .li-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        width: 100%;
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
        border: none;
        padding: 5px 10px;
        border-radius: 3px;
        /* flex-grow: 1; */
        /* Restricts the maximum width to avoid taking up too much space */
        margin-right: 10px;
        width: 50vw;
        border-color: red;
    }

    .btn-secondary {
        background-color: transparent;
        border: none;
        cursor: pointer;
    }

    .collapsible {
        background-color: transparent;
        color: #333333;
        cursor: pointer;
        border: 1px solid #ccc;
        font-size: 16px;
        border-radius: 50%;
        margin-right: 10px;
        height: 32px;
        width: 32px;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .collapsible.active, .collapsible:hover {
        background-color: #dcdcdc;
    }

    .content {
        width: 95vw; 
        overflow: hidden; 
        display: none;
        margin-top: 10px;
        justify-content: space-between; 
        align-items: stretch;
    }

    .diff-container {
        width: 97%;
        margin-left: 2%
    }

    b {
        white-space: nowrap;
        color: #666;
        font-size: smaller;
        margin-right: 10px;
        flex-shrink: 0;
        /* Prevents the filename from shrinking */
        width: 150px;
        /* Keeps a consistent width */
        overflow: hidden;
        text-overflow: ellipsis;
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

    .d2h-code-side-linenumber{
        position: relative !important;
    }

    .left-container{
        width: 70%;
    }

    .resources {
        width: 30%;
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