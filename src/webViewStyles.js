const webViewStyles = `
    /* General body styling for light theme */
    body {
        font-family: Arial, sans-serif;
        background-color: #f5f5f5; /* Light grey background */
        color: #333333; /* Dark text color */
    }

    /* Grouped Events styling */
    h1 {
        font-size: 24px;
        margin-bottom: 20px;
        color: #333333; /* Darker color for headers */
    }

    ul {
        list-style-type: none;
        padding-left: 0;
    }

    li {
        margin-bottom: 15px;
    }

    /* Editable title input */
    .editable-title {
        background-color: #ffffff; /* White background */
        color: #333333; /* Dark text */
        border: 1px solid #ccc; /* Light grey border */
        padding: 5px 10px;
        border-radius: 3px;
        margin-right: 10px;
    }

    /* Collapsible button styling */
    .collapsible {
        background-color: #e7e7e7; /* Light grey background */
        color: #333333; /* Dark text */
        cursor: pointer;
        padding: 10px;
        width: auto;
        border: 1px solid #ccc; /* Light grey border */
        text-align: left;
        outline: none;
        font-size: 16px;
        border-radius: 3px;
        margin-bottom: 5px;
    }

    .collapsible.active, .collapsible:hover {
        background-color: #dcdcdc; /* Darker grey on hover */
    }

    .content {
        padding: 0 18px;
        display: none;
        overflow: hidden;
        background-color: #ffffff; /* White background for content */
        border-radius: 3px;
        margin-top: 5px;
        border-left: 4px solid #007acc; /* Blue accent border */
    }

    /* diff2html styling */
    .d2h-wrapper {
        background-color: #ffffff !important; /* White background */
        color: #333333 !important; /* Dark text */
    }

    .d2h-file-header {
        background-color: #f7f7f7 !important; /* Light grey header */
        color: #333333 !important; /* Dark text */
        border: 1px solid #ddd !important; /* Light grey border */
    }

    .d2h-file-diff {
        background-color: #ffffff !important; /* White background for diff content */
        color: #333333 !important; /* Dark text */
        border-radius: 3px;
    }

    .d2h-code-side-line {
        background-color: #f7f7f7 !important; /* Light grey for line numbers */
        color: #555555 !important; /* Darker text for line numbers */
    }

    .d2h-del {
        background-color: #ffdddd !important; /* Light red for deletions */
        color: #a33a3a !important; /* Dark red text for readability */
    }

    .d2h-ins {
        background-color: #ddffdd !important; /* Light green for insertions */
        color: #3a7a3a !important; /* Dark green text for readability */
    }

    /* Link styling */
    a {
        color: #007acc; /* Blue for links */
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

`;

const contentTimelineStyles = `
    body {
        font-family: Arial, sans-serif;
        background-color: #f5f5f5; /* Light grey background */
        color: #333333; /* Dark text color */
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

    .diff-container {
        font-size: 12px;
        background-color: #ffffff;
        color: #333333;
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
        margin-top: 10px;
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
    webViewStyles,
    contentTimelineStyles,
};