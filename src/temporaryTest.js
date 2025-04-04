const fs = require('fs');
const path = require('path');

class temporaryTest {
    constructor(filePath){
        this.data = this.readData(filePath);
    }

    readData(filePath){
        try{
            const data = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(data);
            return parsedData;
        } catch (err){
            console.error(err);
        }
    }

    // Function to process and extract the subgoal details
    processSubgoals(data) {
        if (!data || !data.subgoals) {
            console.log('No subgoals found in the data.');
            return;
        }

        let codeActivities = [];

        data.subgoals.forEach(subgoal => {
            // console.log(`Subgoal ID: ${subgoal.id}`);
            // console.log(`Title: ${subgoal.title}`);

            // Construct the code change array
            const codeChanges = this.constructCodeChangeArray(subgoal);

            // Construct the final subgoal object (ie codeActivity)
            const codeActivity = {
                id: subgoal.id,
                title: subgoal.title,
                codeChanges: codeChanges
            };

            codeActivities.push(codeActivity);
        });

        return codeActivities;
    }

    processResources(data) {
        if (!data || !data.subgoals) {
            console.log('No subgoals found in the data.');
            return;
        }

        let resourceList = [];

        data.subgoals.forEach(subgoal => {
            const searchHistory = this.constructSearchHistoryArrary(subgoal);

            const codeActivity = {
                id: subgoal.id,
                title: subgoal.title,
                resources: searchHistory
            };

            resourceList.push(codeActivity);
        });

        return resourceList;
    }
    
    processHistories(data) {
        if (!data || !data.subgoals) {
            console.log('No subgoals found in the data.');
            return;
        }

        let historyList = [];

        data.subgoals.forEach(subgoal => {
            const codeChanges = this.constructCodeChangeArray(subgoal);
            const searchHistory = this.constructSearchHistoryArrary(subgoal);

            const codeActivity = {
                title: subgoal.title,
                resources: searchHistory
            };

            historyList.push(codeActivity);
        });

        return historyList;
    }

    // Function to construct the codeChange array from subgoal actions
    constructCodeChangeArray(subgoal) {
        let codeChanges = [];

        subgoal.actions.forEach(action => {
            if (action.type === 'code') {
                let codeChange = {
                    type: "code",
                    id: action.id, // id from data
                    file: action.file, // file name from data
                    time: action.time, // time from data
                    before_code: action.before_code, // before_code from data
                    after_code: action.after_code, // after_code from data
                    title: action.title // title from data
                };
                codeChanges.push(codeChange);
            }
        });

        return codeChanges;
    }

    //for searches 
    constructSearchHistoryArrary(research) {
        let resources = [];
        
        research.actions.forEach(action => {
            if (action.type === 'search') {
                let searchHistory = {
                    type: "search",
                    query: action.query,
                    time: action.time, 
                    actions: []
                };

                action.actions.forEach(subAction => {
                    let actionDetail = {
                        type: subAction.type,
                        webTitle: subAction.webTitle,
                        img: subAction.img,
                        webpage: subAction.webpage,
                        time: subAction.time
                    };
                    
                    searchHistory.actions.push(actionDetail);
                });
                
                resources.push(searchHistory);
            }
        });
        return resources;
    }
}

module.exports = temporaryTest;