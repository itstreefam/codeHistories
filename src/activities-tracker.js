const vscode = require('vscode');

module.exports = class activitiesTracker {
    constructor(doc) {
        this.start = new vscode.Position(0, 0);
        this.end = new vscode.Position(0, 0);
        this.doc = doc;
        this.isChanging = false;
        this._stages = [];
        this._changes = [];
    }

    timestamp() {
        var time = Date.now || function() {
            return +new Date;
        };
        return time();
    }

    captureChangesHelper(event, range){
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
            noOfLines: noOfLines,
            fileType: event.document.languageId,
        };
        this._changes.push(change);
    }

    fileChangesHelper(changes, t, fileAction) {
        // get first change and last change
        // save these and a few other changes to _stages
        // doc can be saveEvent, deleteEvent, closeEvent
        var firstChangeState = {
            text: changes[0].text.slice(0, changes[0].text.length - 1),
            timestamp: changes[0].timestamp,
        };
        var lastChangeState = {
            text: changes[changes.length - 1].text,
            timestamp: t
        };
        var fileChange = {
            firstChangeState: firstChangeState,
            lastChangeState: lastChangeState,
            fileType: changes[changes.length - 1].fileType,
            noOfLines: changes[changes.length - 1].noOfLines,
            fileAction: fileAction
        };
        this._stages.push(fileChange);
    }

    // make a function to start tracking
    startTracking() {
        var editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // capture the current dirty changes in the document
        vscode.workspace.onDidChangeTextDocument(changeEvent => {
            if(changeEvent.document.uri.path == this.doc.uri.path){
                // console.log(`Changing: ${changeEvent.document.uri}`);
                if (!this.isChanging) {
                    // console.log('This is the first change in the document.');
                    this.start = changeEvent.contentChanges[0].range.start;
                    this.isChanging = true;
                }
                this.end = changeEvent.contentChanges[changeEvent.contentChanges.length - 1].range.end;
                this.captureChangesHelper(changeEvent, new vscode.Range(this.start, this.end));
            }
        });

        // if the document is saved
        vscode.workspace.onDidSaveTextDocument(saveEvent => {
            if(saveEvent.uri.path == this.doc.uri.path){
                // console.log('Saved!');
                var saveTime = this.timestamp();
                this.fileChangesHelper(this._changes, saveTime, 'saved');
                this.isChanging = false;
                // reset _changes
                this._changes = [this._changes[this._changes.length - 1]];
            }
        });
        
        // if the document is closed
        vscode.workspace.onDidCloseTextDocument(closeEvent => {
            if(closeEvent.uri.path == this.doc.uri.path){
                // console.log('Closed!');
                var closeTime = this.timestamp();
                this.fileChangesHelper(this._changes, closeTime, 'closed');
                this._changes = [this._changes[this._changes.length - 1]];
            }
        });

        // if the document is deleted
        vscode.workspace.onDidDeleteFiles(deleteEvent => {
            if(deleteEvent.files[0].path == this.doc.uri.path){
                // console.log('Deleted!');
                var deleteTime = this.timestamp();
                this.fileChangesHelper(this._changes, deleteTime, 'deleted');
                this._changes = [];
            }
        });

        console.log('start tracking');
    }

    getCurrentStage() {
        if(this._stages.length > 0){
            console.log(this._stages);
        }
        else{
            console.log('No stages yet');
        }
    }
}