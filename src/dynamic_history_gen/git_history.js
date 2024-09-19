const cp = require('child_process');
const util = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class GitHistory {

    constructor(gitFolder, eventsData) {
        this.gitFolder = gitFolder;
        this.eventsData = eventsData;

        this.exec = util.promisify(cp.exec);
        this.readFile = util.promisify(fs.readFile);

        this.pseudoGitCmd = "";

        // if the git folder has codeHistories.git, then use it
        if(fs.existsSync(path.join(this.gitFolder, "codeHistories.git"))) {
            this.pseudoGitCmd = "--git-dir=codeHistories.git --work-tree=.";
        }

        // trim username code_text for privacy
        this.userName = os.userInfo().username;

        this.gitData = this.constructGitData();

        // put this db in gitFolder/CH_cfg_and_logs
        let dbFile = path.join(this.gitFolder, "CH_cfg_and_logs", "gitData.db");

        // if db file exists, delete it
        if (fs.existsSync(dbFile)) {
            try {
                fs.unlinkSync(dbFile);
                console.log("Delete File successfully.");
            } catch (error) {
                console.log("ERROR: " + error.stack);
            }
        }

        // create new db file
        console.log("creating new db file");
        this.db = new sqlite3.Database(dbFile);
        console.log("db file created");
        this.db.run = util.promisify(this.db.run);

        // create table
        this.db.run(`CREATE TABLE IF NOT EXISTS CodingEvents (
            eventID INTEGER PRIMARY KEY,
            videoID INTEGER,
            timed_url VARCHAR(255),
            time INTEGER,
            img_file VARCHAR(255),
            text_file VARCHAR(255),
            notes VARCHAR(255),
            code_text TEXT,
            diff_text TEXT,
            coords VARCHAR(255)
        );`).then(() => {
            console.log("Table created!");
        }).catch((err) => {
            console.log("ERROR: " + err.stack);
        });

        // this.exportToJSON();
        this.exportToDB();
    }

    async getEntries(sourceVideoID, offset, end, order, limit) {
        console.log("interval " + offset + " - " + end);
        try {
            let gitData = await this.gitData;
            let rows = [];
            if(end == 0){
                // filter first 20 events
                rows = gitData.filter(event => event.time >= offset);
            } else {
                // filter events between offset and end
                rows = gitData.filter(event => event.time >= offset && event.time <= end);
            }

            if(order == 'DESC') {
                rows = rows.reverse();
            }

            rows = rows.slice(0, limit);
            console.log('returning entries...');
            return rows;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return ("ERROR: " + err);
        }
    }

    async getEventList(sourceVideoID, offset, order) {
        try {
            let gitData = await this.gitData;

            let selectedEvents = gitData.filter(event => event.time >= offset);
            if(order == 'DESC') {
                selectedEvents = selectedEvents.reverse();
            }

            // return only time, notes, and img_file from gitData
            let rows = [];
            for (let i = 0; i < selectedEvents.length; i++) {
                let selectedEvent = selectedEvents[i];
                let row = {};
                row.time = selectedEvent.time;
                row.notes = selectedEvent.notes;
                row.img_file = selectedEvent.img_file;
                rows.push(row);
            }
            
            console.log('returning entries...');
            return rows;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return ("ERROR: " + err);
        }
    }

    async getCodeText(sourceVideoID, offset, order, limit) {
        console.log("offset " + offset);
        console.log("order " + order);
        console.log("limit " + limit);

        try {
            let gitData = await this.gitData;

            // filter out events where code text is not null
            let selectedEvents = gitData.filter(event => event.code_text !== null);
            selectedEvents = selectedEvents.filter(event => event.time >= offset);
            if(order == 'DESC') {
                selectedEvents.reverse();
            }
            selectedEvents = selectedEvents.slice(0, limit);

            // make json object containing the following fields: id, time, notes, code_text
            let rows = [];
            for (let i = 0; i < selectedEvents.length; i++) {
                let selectedEvent = selectedEvents[i];
                let row = {};
                row.id = selectedEvent.id;
                row.time = selectedEvent.time;
                row.notes = selectedEvent.notes;
                row.code_text = selectedEvent.code_text;
                rows.push(row);
            }

            console.log('returning entries...');
            return rows;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return ("ERROR: " + err);
        }
    }

    async getCommentsInRange(sourceVideoID, startTime, endTime) {
        return ("ERROR: No comments recorded");
    }

    async getCodeInRange(startTime, endTime) {
        try{
            let gitData = await this.gitData;
            let selectedEvents = gitData.filter(event => event.code_text !== null);
            selectedEvents = selectedEvents.filter(event => event.time >= startTime && event.time <= endTime);
            // return only id, time, notes and code_text from gitData
            let rows = [];
            for (let i = 0; i < selectedEvents.length; i++) {
                let selectedEvent = selectedEvents[i];
                let row = {};
                row.id = selectedEvent.id;
                row.time = selectedEvent.time;
                row.notes = selectedEvent.notes;
                row.code_text = selectedEvent.code_text;
                rows.push(row);
            }
            console.log('returning entries...');
            return rows;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return ("ERROR: " + err);
        }
    }

    async getSearchesInRange(startTime, endTime) {
        try{
            let gitData = await this.gitData;
            let selectedEvents = gitData.filter(event => event.code_text === null);
            selectedEvents = selectedEvents.filter(event => !event.notes.startsWith("commit:"));

            // if end time <= 0, then return all events (mostly for accessing searchEvts in CodeStoriesViz)
            if(endTime <= 0) {
                selectedEvents = selectedEvents.filter(event => event.time >= startTime);
            } else {
                let smallerTime = Math.min(startTime, endTime);
                let largerTime = Math.max(startTime, endTime);
                selectedEvents = selectedEvents.filter(event => event.time >= smallerTime && event.time <= largerTime);
            }

            // return only id, time, notes and img_file from gitData
            let rows = [];
            for (let i = 0; i < selectedEvents.length; i++) {
                let selectedEvent = selectedEvents[i];
                let row = {};
                row.id = selectedEvent.id;
                row.time = selectedEvent.time;
                row.notes = selectedEvent.notes;
                row.img_file = selectedEvent.img_file;
                rows.push(row);
            }
            console.log('returning entries...');
            return rows;
        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }


    async newEntry(sourceVideoID, data, time) {
        return ("ERROR: can't add entries to git history")
    }

    async deleteEntry(eventID) {
       return ("ERROR: can't modify git history")
    }
  
    async getMaxEventID() {     
        return ("ERROR: not needed" );
    }

    async recordCodeInfo(codeImage, codeText) {  
        return ("ERROR: no recording to git history ");
    }

    async recordWebInfo(webImage) {
        return ("ERROR: no recording to git history ");
    }

    async updateOcrBox(eventID, coords) {
        return ("ERROR: no recording to git history ");
    }

    async updateCodeText(eventID, code_text) {
        return ("ERROR: no recording to git history ");
    }

    async constructGitData() {
        try {
            let events = await this.combineWebEventsAndCommits();
            let gitData = [];
            // console.log(events);

            // make json object containing the following fields: id, timed_url, time, notes, img_file, code_text, coords
            for (let i = 0; i < events.length; i++) {
                let event = events[i];

                let excludeList = ['.png', '.jpg', '.jpeg', '.gif', '.mp4', 
                                    '.mov', '.avi', '.mpg', '.mpeg', '.wmv', 
                                    '.flv', '.mkv', '.webm', '.DS_Store', '.otf', 
                                    '.eot', '.svg', '.ttf', '.woff', '.woff2',
                                    '.pyc', '.sqlite3', '.db', '.pdf', '.ico', '.csv', 
                                    '.gitignore', '.vscode/settings.json', 'webData', '.env.development',
                                    'package-lock.json', 'package.json', 'README.md', 'LICENSE', 'yarn.lock', 'node_modules', 'aclImdb'];
                
                let skipCodeEvent = false;
                for (let i = 0; i < excludeList.length; i++) {
                    if(event.info == null) {
                        skipCodeEvent = true;
                        break;
                    }

                    if (event.info.includes(excludeList[i])) {
                        skipCodeEvent = true;
                        break;
                    }
                }

                if (skipCodeEvent) {
                    continue;
                }

                let entry = {};
                entry.id = i + 1;
                if(event.timed_url) {
                    entry.timed_url = event.timed_url;
                } else {
                    entry.timed_url = event.curTitle;
                }
                entry.time = event.time;
                entry.notes = event.action + ": " + event.info + ";"; // combine action and info
                entry.img_file = event.img_file;

                // if event action is "code" commit, then get code text
                if (event.action == "code" || event.action == "output") {
                    let id = event.commitId;
                    let hashObj = this.hashObjsList.find(hashObj => hashObj.commitId == id);
                    // event.info contains the filename that was changed
                    //fileInfo contains both code text and diff text
                    let fileInfo = await this.getCodeTextHelper(hashObj.hash, event.info, this.gitFolder);
                    
                    if(fileInfo){
                        if(fileInfo.code_text.stderr !== "") {
                            entry.code_text = fileInfo.code_text.stderr.toString();
                            entry.diff_text = fileInfo.diff_text.stderr.toString();
                        } else {
                            entry.code_text = fileInfo.code_text.stdout.toString();
                            entry.diff_text = fileInfo.diff_text.stdout.toString();
                            // trim everything before codehistories (usually contains username)
                            let codeHistoriesIndex = entry.code_text.indexOf("codehistories");
                            if(codeHistoriesIndex > 0) {
                                entry.code_text = entry.code_text.substring(codeHistoriesIndex);
                            }

                            // replace all occurences of this.userName with "user"
                            if(this.userName.length > 0 && entry.code_text.includes(this.userName)){
                                entry.code_text = entry.code_text.split(this.userName).join("user");
                            }
                        }
                    }

                    // console.log(entry.code_text);
                    entry.timed_url = null;
                    entry.img_file = null;
                } else {
                    if(event.img_file){
                        if(event.img_file.includes("\r")) {
                            entry.img_file = entry.img_file.replace("\r", "");
                        }
                    }
                    entry.code_text = null;
                    entry.diff_text = null;
                }

                entry.coords = null;
                // console.log(i, event.info);
                gitData.push(entry);
            }

            //offset time (maybe real time makes it easier to add potential missing events)
            // let offset = gitData[0].time;
            // for (let i = 0; i < gitData.length; i++) {
            //     gitData[i].time = gitData[i].time - offset;
            // }

            console.log('Git data constructed!');
            return gitData;
        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }
    
    async combineWebEventsAndCommits() {
        try {
            this.hashObjsList = await this.constructHashObjsList(this.gitFolder);
            this.eventsList = await this.constructEventsList(this.eventsData);

            if(this.eventsList.length > 0 && this.hashObjsList.length > 0) {
                // combine and sort the time of events and commits
                let combinedTimeList = [];
                for (let i = 0; i < this.eventsList.length; i++) {
                    combinedTimeList.push(this.eventsList[i].time);
                }
                for (let i = 0; i < this.hashObjsList.length; i++) {
                    combinedTimeList.push(this.hashObjsList[i].time);
                }
                combinedTimeList.sort((a, b) => a - b);

                // remake the eventsList with the combined time list
                let newEventsList = [];
                for (let i = 0; i < combinedTimeList.length; i++) {
                    // filter out the events that have the same time as the combined time list
                    let filteredEvents = this.eventsList.filter(event => event.time == combinedTimeList[i]);

                    // either [] or [event]
                    // these are web events so they are unique
                    if(filteredEvents.length > 0) {
                        newEventsList.push(filteredEvents[0]);
                    }

                    // filter out the commits that have the same time as the combined time list
                    let filteredHashObjs = this.hashObjsList.filter(hashObj => hashObj.time == combinedTimeList[i]);
                    // console.log(filteredHashObjs);
                    
                    if (filteredHashObjs.length > 0) {
                        // for each file changed, add a new event
                        for (let j = 0; j < filteredHashObjs[0].filesChanged.length; j++) {
                            let fileChanged = filteredHashObjs[0].filesChanged[j];
                            let action = "code";
                            if(fileChanged == "output.txt") {
                                action = "output";
                            }
                            let newEvent = {time: filteredHashObjs[0].time, action: action, info: fileChanged, commitId: filteredHashObjs[0].commitId};
                            newEventsList.push(newEvent);
                        }
                    }
                }
                console.log('Combined web data events and commits');
                // console.log(newEventsList);
                return newEventsList;
            }
            // if eventsList is empty, then just return the hashObjsList
            else if(this.hashObjsList.length > 0) {
                let newEventsList = [];
                for (let i = 0; i < this.hashObjsList.length; i++) {
                    let hashObj = this.hashObjsList[i];
                    for (let j = 0; j < hashObj.filesChanged.length; j++) {
                        let fileChanged = hashObj.filesChanged[j];
                        let action = "code";
                        if(fileChanged == "output.txt") {
                            action = "output";
                        }
                        let newEvent = {time: hashObj.time, action: action, info: fileChanged, commitId: hashObj.commitId};
                        newEventsList.push(newEvent);
                    }
                }
                console.log('Returning only commits');
                // console.log(newEventsList);
                return newEventsList;
            }

        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }
    
    async constructHashObjsList(gitFolder) {
        try{
            let gitLogAllHashes = `git ${this.pseudoGitCmd} log --pretty=format:%h`;
            let hashes = await this.exec(gitLogAllHashes, {cwd: gitFolder});
            hashes = hashes.stdout.toString().split('\n');
            hashes = hashes.filter(hash => hash !== '');
            hashes.reverse();

            let hashObjsList = [];

            for (let i = 0; i < hashes.length; i++) {
                // make an array of objects where each object contains the hash an the commit time
                let hash = hashes[i];
                let gitLogHash = `git ${this.pseudoGitCmd} log -1 --pretty=%B ${hash}`;
                let commitMessage = await this.exec(gitLogHash, {cwd: gitFolder});

                if(commitMessage.stdout) {
                    commitMessage = commitMessage.stdout.toString();
                } else {
                    commitMessage = null;
                }

                // only consider those commitMessages that has the form of [Commit time: 11/1/2023, 1:25:35 PM]
                if(commitMessage && commitMessage.includes("[Commit time:")) {
                    let gitLogTime = `git ${this.pseudoGitCmd} log -1 --pretty=%ct ${hash}`;
                    let time = await this.exec(gitLogTime, {cwd: gitFolder});
                    time = parseInt(time.stdout.toString());
                    // console.log(time);

                    // get files changed
                    let filesChanged = await this.getFilesChangedInCommit(hash, gitFolder);

                    hashObjsList.push({hash: hash, time: time, commitId: i+1, filesChanged: filesChanged});
                }
            }
            // console.log(hashObjsList);
            console.log('Hash objects list constructed!');
            return hashObjsList;
        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }

    async constructEventsList(eventsData) {
        try {
            if (!eventsData) {
                throw new Error('Events data is undefined or null');
            }
            let events = await this.csvJSON(eventsData);
            console.log('Events list constructed!');
            return events;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return [];
        }
    }

    // https://stackoverflow.com/questions/27979002/convert-csv-data-into-json-format-using-javascript
    async csvJSON(csv){
        var lines=csv.split("\n");
        var result = [];
      
        // NOTE: If your columns contain commas in their values, you'll need
        // to deal with those before doing the next step 
        // (you might convert them to &&& or something, then covert them back later)
        // jsfiddle showing the issue https://jsfiddle.net/
        var headers=lines[0].split("\t");
    
        // delimit empty space
        for (let i = 0; i < headers.length; i++) {
            headers[i] = headers[i].trim();
        }
      
        for(var i=1;i<lines.length;i++){
            var obj = {};
            var currentline=lines[i].split("\t"); // split on tab because there might be , ; : etc. in the info
      
            for(var j=0;j<headers.length;j++){
                obj[headers[j]] = currentline[j];
            }
      
            result.push(obj);
      
        }
    
        // delete all title keys
        if(headers.includes('title')) {
            for (let i = 0; i < result.length; i++) {
                // if title is undefined, delete the whole object
                if (result[i].title == undefined) {
                    result.splice(i, 1);
                }
                // if title is not undefined, delete the title key
                else {
                    delete result[i].title;
                }
            }
        }
      
        return result; //JavaScript object
    }

    async getCodeTextHelper(hash, file, gitFolder) {
        try {
            let gitShowFileContent = `git ${this.pseudoGitCmd} show ${hash}:"${file}"`;
            let code_text = await this.exec(gitShowFileContent, {cwd: gitFolder, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024});
            
            // Get the first commit hash in the repository
            let firstCommitHashCmd = `git ${this.pseudoGitCmd} rev-list --max-parents=0 HEAD`;
            let firstCommitHashResult = await this.exec(firstCommitHashCmd, {cwd: gitFolder});
            let firstCommitHash = firstCommitHashResult.stdout.trim().substring(0, 7);

            let gitDiffFileContent;
            if (hash == firstCommitHash) {
                // If this is the first commit, it's basically all new additions
                gitDiffFileContent = `git ${this.pseudoGitCmd} show ${hash}:"${file}"`;
                let diff_text = await this.exec(gitShowFileContent, {cwd: gitFolder, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024});
                // decorate the diff_text with 
                // index 0000000..7d9da2b
                // @@ -0,0 +1,25 @@

                let lines = diff_text.stdout.split('\n');
                let decoratedDiffText = `index 0000000..${hash}\n@@ -0,0 +1,${lines.length} @@\n`;
                decoratedDiffText += diff_text.stdout;

                // every line should start with a +
                let decoratedLines = decoratedDiffText.split('\n');
                for (let i = 0; i < decoratedLines.length; i++) {
                    if(decoratedLines[i].startsWith("index")) {
                        continue;
                    }
                    if(decoratedLines[i].startsWith("@@")) {
                        continue;
                    }
                    decoratedLines[i] = "+" + decoratedLines[i];
                }
                decoratedDiffText = decoratedLines.join('\n');
                diff_text.stdout = decoratedDiffText;

                return { code_text, diff_text };
            } else {
                // Otherwise, show the diff between this hash and the previous hash to see what was changed
                let prevHashCmd = `git ${this.pseudoGitCmd} rev-list --parents -n 1 ${hash}`;
                let prevHashResult = await this.exec(prevHashCmd, {cwd: gitFolder});
                let prevHash = prevHashResult.stdout.trim().split(' ')[1].substring(0, 7);
                gitDiffFileContent = `git ${this.pseudoGitCmd} diff ${prevHash} ${hash} -- "${file}"`;
                let diff_text = await this.exec(gitDiffFileContent, {cwd: gitFolder, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024});
                return { code_text, diff_text };
            }
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return null;
        }
    }    

    async getFilesChangedInCommit(hash, gitFolder) {
        try {
            let gitShowFilesChange = `git ${this.pseudoGitCmd} show --name-only --pretty="" ${hash}`;
            let filesChanged = await this.exec(gitShowFilesChange, {cwd: gitFolder, encoding:'utf8', maxBuffer: 1024 * 1024 * 1024 });
            filesChanged = filesChanged.stdout.toString().split('\n');
            filesChanged = filesChanged.filter(file => file !== '');

            let excludeList = ['.png', '.jpg', '.jpeg', '.gif', '.mp4', 
                            '.mov', '.avi', '.mpg', '.mpeg', '.wmv', 
                            '.flv', '.mkv', '.webm', '.DS_Store', '.otf', 
                            '.eot', '.svg', '.ttf', '.woff', '.woff2',
                            '.pyc', 'README.md', 'LICENSE', 'yarn.lock', 'node_modules', 'aclImdb'];
            
            // filter out files that are in the exclude list
            for (let i = 0; i < excludeList.length; i++) {
                filesChanged = filesChanged.filter(file => !file.includes(excludeList[i]));
            }

            // filesChanged = filesChanged.filter(file => file.endsWith('.py') || file == 'output.txt');
            // console.log(filesChanged);
            return filesChanged;
        } catch (err) {
            console.log("ERROR: " + err.stack);
            return null;
        }
    }

    async exportToJSON() {
        try {
            let json = JSON.stringify(await this.gitData);
            fs.writeFile('gitData.json', json, 'utf8', function (err) {
                if (err) {
                    console.log("An error occured while writing JSON Object to File.");
                    return console.log(err);
                }
            });
            console.log('JSON file exported!');
        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }

    async exportToDB() {
        try {
            let gitData = await this.gitData;

            // insert data
            let i = 0;
            while (i < gitData.length) {
                let event = gitData[i];
                let eventID = event.id;
                let videoID = 2;
                let timed_url = event.timed_url;
                let time = event.time;
                let img_file = event.img_file;
                let text_file = null;
                let notes = event.notes;
                let code_text = event.code_text;
                let diff_text = event.diff_text;
                let coords = null;

                this.db.run(`INSERT or REPLACE INTO CodingEvents 
                            (eventID, videoID, timed_url, time, img_file, text_file, notes, code_text, diff_text, coords) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, 
                            [eventID, videoID, timed_url, time, img_file, text_file, notes, code_text, diff_text, coords]
                            ).then(() => {
                                console.log(`Event ${eventID} inserted!`);
                            }).catch((err) => {
                                console.log("ERROR: " + err);
                            });

                i++;
            }

            if (i == gitData.length) {
                // close the database connection
                this.db.close(err => {
                    if (err) {
                        return console.error(err.message);
                    }
                    console.log('Close the database connection.');
                });
            }            
        } catch (err) {
            console.log("ERROR: " + err.stack);
        }
    }
}
  
module.exports = GitHistory;
