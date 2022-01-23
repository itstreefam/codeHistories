const vscode = require('vscode');

var changes = [];
var isDirty = [];
var stages = [];

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

    captureTextChangeHelper(event, range){
        // use get text from the range given
        // use the timestamp to create a new object
        // push the object to the changes array
        // return the changes array
        if(range.isEmpty){
            return;
        }
        var noOfLines = range.end.line - range.start.line + 1;
        var text = event.document.getText(range) + event.contentChanges[event.contentChanges.length - 1].text;
        var change = {
            text: text,
            timestamp: this.timestamp(),
            fileType: event.document.languageId,
            filePath: event.document.uri.path,
            noOfLines: noOfLines
        };
        changes.push(change);
        return changes;
    }

    fileChangeHelper(doc, changes, t, option) {
        // get first change and last change
        // save these and a few other changes to the stages array
        // doc can be saveEvent, deleteEvent, closeEvent
        // saveEvent and closeEvent have the same type Event<TextDocument>
        // while deleteEvent has the type Event<FileDeleteEvent>
        var firstChange = {
            text: changes[0].text,
            timestamp: changes[0].timestamp,
        };
        var lastChange = {
            text: changes[changes.length - 1].text,
            timestamp: t
        };
        var fileChange = {
            firstChange: firstChange,
            lastChange: lastChange,
            fileType: '',
            filePath: '',
            noOfLines: changes[changes.length - 1].noOfLines,
            isSaved: false,
            isDeleted: false,
            isClosed: false,
        };

        if(option == 'save'){
            fileChange.isSaved = true;
            fileChange.fileType = doc.languageId;
            fileChange.filePath = doc.uri.path;
        }
        if(option == 'delete'){
            for (var i = 0; i < stages.length; i++) {
                if(stages[i].filePath == doc.files[0].path && stages[i].isClosed == true){
                    fileChange.isDeleted = true;
                    fileChange.fileType = stages[i].fileType;
                    fileChange.filePath = stages[i].filePath;
                }
            }
        }
        if(option == 'close'){
            fileChange.isClosed = true;
            fileChange.fileType = doc.languageId;
            fileChange.filePath = doc.uri.path;
        }
        stages.push(fileChange);
    }

    specificFileChange(changes, filePath) {
        // get the changes for a specific file
        // delete these changes from the changes array
        // return the changes
        var fileChanges = [];
        for (var i = 0; i < changes.length; i++) {
            if (changes[i].filePath == filePath) {
                fileChanges.push(changes[i]);
            }
        }
        return fileChanges;
    }

    captureTextChange() {
        // capture the current dirty changes in the document
        vscode.workspace.onDidChangeTextDocument(changeEvent => {
            // console.log(`Did change: ${changeEvent.document.uri}`);
            if (!isDirty.includes(changeEvent.document.uri.path) && changeEvent.contentChanges.length > 0) {
                // console.log('This is the change that made this file "dirty".');
                isDirty.push(changeEvent.document.uri.path);

                // only gets executed once
                this.start = changeEvent.contentChanges[0].range.start;
            }
            this.end = changeEvent.contentChanges[changeEvent.contentChanges.length - 1].range.end;
            this.captureTextChangeHelper(changeEvent, new vscode.Range(this.start, this.end));
        });
    
        // if the document is saved, remove the document from isDirty array
        vscode.workspace.onDidSaveTextDocument(saveEvent => {
            // console.log('Saved!');
            var saveTime = this.timestamp();
            var index = isDirty.indexOf(saveEvent.uri.path);
            if (index > -1) {
                isDirty.splice(index, 1);
            }
            var fileChanges = this.specificFileChange(changes, saveEvent.uri.path);
            this.fileChangeHelper(saveEvent, fileChanges, saveTime, 'save');
            console.log(stages);
        });

        // if the document is closed, remove the document from isDirty array
        vscode.workspace.onDidCloseTextDocument(closeEvent => {
            // console.log('Closed!');
            var closeTime = this.timestamp();
            var index = isDirty.indexOf(closeEvent.uri.path);
            if (index > -1) {
                isDirty.splice(index, 1);
            }
            var fileChanges = this.specificFileChange(changes, closeEvent.uri.path);
            this.fileChangeHelper(closeEvent, fileChanges, closeTime, 'close');
            console.log(stages);
        });

        // if the document is deleted, remove the document from isDirty array
        vscode.workspace.onDidDeleteFiles(deleteEvent => {
            // console.log('Deleted!');
            var deleteTime = this.timestamp();
            var fileChanges = this.specificFileChange(changes, deleteEvent.files[0].path);
            this.fileChangeHelper(deleteEvent, fileChanges, deleteTime, 'delete');
            console.log(stages);
        });
    }
}

    
