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

    // processGoalData(data) {
    //     const goal = {
    //         title: data.title,
    //         subgoals: []
    //     };
    
    //     data.subgoals.forEach(subgoal => {
    //         const subgoalData = {
    //             id: subgoal.id,
    //             title: subgoal.title,
    //             actions: []
    //         };
    
    //         subgoal.actions.forEach(action => {
    //             const actionData = {
    //                 id: action.id,
    //                 title: action.title,
    //                 file: action.file,
    //                 time: action.time,
    //                 before_code: action.before_code,
    //                 after_code: action.after_code,
    //                 code_regions: action.code_regions
    //             };
    
    //             subgoalData.actions.push(actionData);
    //         });
    
    //         goal.subgoals.push(subgoalData);
    //     });
    
    //     return goal;
    // }

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
}

module.exports = temporaryTest;