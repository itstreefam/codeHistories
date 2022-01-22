const vscode = require('vscode');

var isDirty = [];
var changes = [];

module.exports = class activitiesTracker {
    constructor() {
        this.start = new vscode.Position(0, 0);
        this.end = new vscode.Position(0, 0);
    }

    timestamp() {
        var time = Date.now || function() {
            return +new Date;
        };
        return time();
    }

    // // make a function that capture the current state of the document
    // currentDocState() {
    //     var editor = vscode.window.activeTextEditor;
    //     if (!editor) {
    //         return;
    //     }
    //     var doc = editor.document;
    //     return doc;
    // }

    // // make a function that find the difference between the current state and the previous state
    // // and return the difference
    // diff() {
    //     // make a copy of the current state
    //     var currentDocState = this.currentDocState();
    //     if (!currentDocState) {
    //         return;
    //     }

    //     // now check if the current state is different from the previous state
    //     var currentDocStateText = currentDocState.getText();

    //     const lines = currentDocStateText.split('\n');
    //     for (let i = 0; i < activeTextEditor.document.lineCount; ++i) {  
    //         const line = activeTextEditor.document.lineAt(i);
    //         if (line.isEmptyOrWhitespace) {
    //             continue;
    //         }
    //         console.log(line.text);
    //      }
    // }

    captureTextChangeHelper(event, range){
        // use get text from the range given
        // use the timestamp to create a new object
        // push the object to the changes array
        // return the changes array
        var text = event.document.getText(range) + event.contentChanges[event.contentChanges.length - 1].text;

        var change = {
            text: text,
            timestamp: this.timestamp()
        };
        changes.push(change);
        console.log(changes);
        return changes;
    }


    captureTextChange() {

        vscode.workspace.onDidChangeTextDocument(changeEvent => {
            console.log(`Did change: ${changeEvent.document.uri}`);

            if (!isDirty.includes(changeEvent.document.uri.path) && changeEvent.contentChanges.length > 0) {
                console.log('This is the change that made this file "dirty".');
                
                isDirty.push(changeEvent.document.uri.path);

                // only gets executed once
                this.start = changeEvent.contentChanges[0].range.start;
            }

            this.end = changeEvent.contentChanges[changeEvent.contentChanges.length - 1].range.end;

            // for (const change of changeEvent.contentChanges) {
            //      console.log(change.range); // range of text being replaced
            //      console.log(change.text); // text replacement
            // }

            // var text = changeEvent.document.getText(new vscode.Range(this.start, this.end)) + changeEvent.contentChanges[changeEvent.contentChanges.length - 1].text;
            this.captureTextChangeHelper(changeEvent, new vscode.Range(this.start, this.end));
       });
        
        vscode.workspace.onDidSaveTextDocument(function(e) {
            console.log('Saved!');

            const index = isDirty.indexOf(e.uri.path);
            
            if (index > -1) {
                isDirty.splice(index, 1);
            }
        });
    }
}

    
