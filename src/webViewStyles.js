// Light theme styles for history view
const historyStyles = `
    html {
        scrollbar-color: var(--vscode-editor-foreground) !important;
    }

    body {
        font-family: Arial, sans-serif;
        background-color: #ffffff;
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
        overflow: auto;
        background-color: #ffffff;
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
    
    .container {
        position: relative;
        text-align: center;
        scale: 1.25;
        margin-right: 2%;
    }
        
    .centered {
        position: absolute;
        top: 45%;
        font-size: 9px;
        z-index: 1000;
        left: 50%;
        transform: translate(-50%, -50%);
        font-weight: bold;
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

    .d2h-del, .d2h-ins, .dh2-cntx {
        width: 100%;
    }

    .d2h-code-side-linenumber{
        position: relative !important;
    }

    .d2h-code-linenumber {
        position: relative !important;
    }

    .d2h-code-line {
        position: relative;
        padding: 0 2em !important;
    }

    .left-container{
        width: 70%;
    }

    .full-container{
        width: 95%;
    }

    .resources {
        width: 30%;
        margin-left: 10px;
    }
        
    .tooltip {
        position: relative;
        display: inline-block;
    }

    .tooltip .tooltiptext {
    background:https://pyxis.nymag.com/v1/imgs/e1e/6b7/e7e202e97398fd64f6f9b6c6d13a526234-tired-spongebob.rsquare.w400.jpg;
    visibility: hidden;
    width: 120px;
    height: 60px;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px 0;
    position: absolute;
    z-index: 1;
    top: 200%;
    left: 30%;
    margin-left: -60px;
    }

    .tooltip:hover .tooltiptext {
    visibility: visible;
    }

    .placeholder {
        width: 13.005px;
        height: 15.360px;
        margin-right: 24.285px;
    }

    .thumbnail .tooltiptext {
        scale: 2;
    }

    .resources h4 {
        font-weight: bold;
        margin-bottom: 5px;
    }

    .resources p {
        margin: 5px 0 10px;
        font-size: 14px;
        color: #333;
    }

    .resource-list {
        list-style-type: disc;
        padding-left: 20px;
        margin-top: 0;
    }

    .resource-item {
        margin-bottom: 8px;
        position: relative; /* Needed for tooltip positioning */
    }

    .resource-item a {
        color: #007bff;
        text-decoration: none;
    }

    .resource-item a:hover {
        text-decoration: underline;
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