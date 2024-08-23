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
    // Filter out rows where the action contains 'empty new tab is active tab'
    // and Remove rows where curTitle is 'New Tab' or 'Extensions'
    return data.filter(row => {
        return !row.action.includes('empty new tab is active tab') &&
               !['New Tab', 'Extensions'].includes(row.curTitle);
    });
}

function assignNewActions(data) {
    data.forEach(row => {
        let newAction = row.action;

        if (row.curTitle.toLowerCase().includes('search') || row.curUrl.includes('https://www.google.com/search')) {
            newAction = 'search';
        }

        if (!['search', 'revisit'].includes(newAction)) {
            newAction = 'visit';
        }

        if (row.action.includes('revisit')) {
            newAction = 'revisit';
        }

        row.new_action = newAction;
    });

    return data;
}

function finalizeActions(data) {
    data.forEach((row, index, arr) => {
        row.seen = arr.slice(0, index).some(prevRow => prevRow.info === row.info);

        if (row.seen) {
            row.new_action = row.new_action === 'search' ? 'research' : 'revisit';
        }

        if (index > 0 && row.info === arr[index - 1].info && !row.info.includes('localhost')) {
            arr.splice(index, 1);
        }

        row.dwell_time = 0;
        if (row.new_action.includes('visit') && index < arr.length - 1) {
            row.dwell_time = arr[index + 1].time - row.time;
        }

        if (row.dwell_time < 5 && row.new_action.includes('visit')) {
            arr.splice(index, 1);
        }

        if (row.new_action === 'research') {
            arr.splice(index, 1);
        }

        row.info = row.info.replace(/"/g, '').trim();
        if (row.action.includes('(')) {
            row.action = row.action.substring(row.action.indexOf('(') + 1, row.action.indexOf(')'));
        }
    });

    data.forEach(row => {
        row.new_action = refineActionLabels(row);
    });

    return data;
}

function refineActionLabels(row) {
    const newAction = row.new_action;
    const oldAction = row.action;

    if (oldAction.includes('typed') && newAction.includes('visit')) {
        return `${newAction} (typed)`;
    } else if (oldAction.includes('form_submit') && newAction.includes('visit')) {
        return `${newAction} (form_submit)`;
    } else if (oldAction.includes('auto_bookmark') && newAction.includes('visit')) {
        return `${newAction} (auto_bookmark)`;
    } else if (oldAction.includes('reload') && newAction.includes('visit')) {
        return `${newAction} (reload)`;
    } else {
        return newAction;
    }
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
    const rawData = initializeColumns(dataList);
    
    if (!rawData) {
        return {
            time: -1,
            img_file: '',
            timed_url: '',
            notes: 'No data available',
        };
    }

    let data = rawData;
    data = initializeColumns(data);
    data = filterUnwantedRows(data);
    data = assignNewActions(data);
    data = finalizeActions(data);
    const outputData = prepareOutputData(data);  
    return outputData;
}

module.exports = {
    processWebData,
};