const fs = require('fs');

function initializeColumns(data) {
    data.forEach((row) => {
        row.info = row.curTitle;
        row.title = row.curTitle;
        row.timed_url = row.curUrl;
        row.img_file = row.img;
    });
    return data;
}

function filterUnwantedRows(data) {
    // Filter out rows where the curTitle contains 'New Tab' or 'Extensions'
    return data.filter(row => {
        const isUnwantedTitle = row.curTitle.toLowerCase().includes('new tab') || row.curTitle.toLowerCase().includes('extensions');
        return !isUnwantedTitle;
    });
}

function assignNewActions(data) {
    data.forEach((row, index) => {
        let newAction = row.action;
        // console.log(`Row ${index} before assignNewActions:`, row);

        if (row.curTitle.toLowerCase().includes('search') || row.curUrl.includes('https://www.google.com/search')) {
            newAction = 'search';
        } else if (row.action.includes('revisit')) {
            newAction = 'revisit';
        } else {
            newAction = 'visit';
        }

        row.new_action = newAction;

        // console.log(`Row ${index} after assignNewActions:`, row);
    });

    return data;
}

function finalizeActions(data) {
    data.forEach((row, index, arr) => {
        row.seen = arr.slice(0, index).some(prevRow => prevRow.info === row.info);

        if (row.seen) {
            row.new_action = 'revisit';
        }

        // Remove duplicate rows
        if (index > 0 && row.info === arr[index - 1].info && !row.info.includes('localhost')) {
            arr.splice(index, 1);
        }

        row.dwell_time = 0;

        // Calculate dwell time
        if (row.new_action.includes('visit') && index < arr.length - 1) {
            row.dwell_time = arr[index + 1].time - row.time;
        }

        // Add dwell time to notes for visit actions and in seconds
        if (row.new_action.includes('visit')) {
            row.info += ` (${row.dwell_time / 1000}s)`;
        }

        // Remove double quotes from info
        row.info = row.info.replace(/"/g, '').trim();
    });

    return data;
}

function prepareOutputData(data) {
    return data.map(row => ({
        time: row.time,
        img_file: row.img_file,
        timed_url: row.timed_url,
        notes: `${row.new_action}: ${row.info};`,
    }));
}

function processWebData(dataList) {
    // console.log('dataList:', dataList);
    const rawData = initializeColumns(dataList);
    
    if (!rawData) {
        return {
            time: -1,
            img_file: '',
            timed_url: '',
            notes: 'No data available',
        };
    }

    // console.log('After initializeColumns:', rawData);

    let data = rawData;
    let afterFilterUnwantedRowsData = filterUnwantedRows(data);
    // console.log('After filterUnwantedRows:', afterFilterUnwantedRowsData);

    let afterAssignNewActionsData = assignNewActions(afterFilterUnwantedRowsData);
    // console.log('After assignNewActions:', afterAssignNewActionsData);

    let afterFinalizeActionsData = finalizeActions(afterAssignNewActionsData);
    // console.log('After finalizeActions:', afterFinalizeActionsData);

    const outputData = prepareOutputData(afterFinalizeActionsData);  
    // console.log('Final outputData:', outputData);
    return outputData;
}

module.exports = {
    processWebData,
};