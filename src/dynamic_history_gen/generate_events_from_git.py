import json
import sys
import pandas as pd

def read_data(filename):
    """Read JSON data from the specified file."""
    with open(filename, 'r') as file:
        return file.read()

def parse_data(data):
    """Parse the JSON data into a Python object."""
    return json.loads(data)

def initialize_columns(dataframe):
    """Initialize the dataframe columns based on webData fields."""
    dataframe['info'] = dataframe['curTitle']
    dataframe['title'] = dataframe['curTitle']
    dataframe['timed_url'] = dataframe['curUrl']
    dataframe['img_file'] = dataframe['img']
    return dataframe

def filter_unwanted_rows(dataframe):
    """Filter out rows where the action contains 'empty new tab is active tab'."""
    dataframe = dataframe[~dataframe['action'].str.contains('empty new tab is active tab')]

    # Remove rows where curTitle is 'New Tab' or 'Extensions'
    dataframe = dataframe[~dataframe['curTitle'].isin(['New Tab', 'Extensions'])]
    
    return dataframe

def assign_new_actions(dataframe):
    """Assign new action types based on the current title and URL."""
    dataframe['new_action'] = dataframe['action']
    dataframe['new_action'] = dataframe.apply(
        lambda row: 'search' if 'search' in row['curTitle'].lower() or 'https://www.google.com/search' in row['curUrl'] else row['new_action'],
        axis=1
    )
    dataframe['new_action'] = dataframe.apply(
        lambda row: 'visit' if row['new_action'] not in ['search', 'revisit'] else row['new_action'],
        axis=1
    )
    dataframe.loc[dataframe['action'].str.contains('revisit'), 'new_action'] = 'revisit'
    return dataframe

def finalize_actions(dataframe):
    """Finalize the action column by handling revisits and refining action labels."""
    dataframe['seen'] = False
    dataframe.loc[dataframe.groupby('info').cumcount() > 0, 'seen'] = True

    seen_indices = dataframe[dataframe['seen'] == True].index
    dataframe.loc[seen_indices, 'new_action'] = dataframe.loc[seen_indices, 'new_action'].apply(
        lambda x: 'research' if x == 'search' else 'revisit'
    )

    # Remove consecutive duplicate visits
    indices = dataframe[(dataframe['info'].shift(1) == dataframe['info']) & (~dataframe['info'].str.contains('localhost'))].index
    dataframe.drop(indices, inplace=True)

    dataframe['dwell_time'] = 0
    dataframe.loc[dataframe['new_action'].str.contains('visit'), 'dwell_time'] = dataframe['time'].shift(-1) - dataframe['time']

    dataframe.drop(dataframe[(dataframe['dwell_time'] < 5) & (dataframe['new_action'].str.contains('visit'))].index, inplace=True)
    dataframe.drop(dataframe[dataframe['new_action'] == 'research'].index, inplace=True)

    dataframe['info'] = dataframe['info'].apply(lambda x: x.replace('"', '').strip())
    dataframe['action'] = dataframe['action'].apply(lambda x: x[x.index('(') + 1:x.index(')')] if '(' in x else x)

    dataframe['new_action'] = dataframe.apply(refine_action_labels, axis=1)

    return dataframe

def refine_action_labels(row):
    """Refine the action labels based on specific conditions."""
    new_action = row['new_action']
    old_action = row['action']

    if ('typed' in old_action) and ('visit' in new_action):
        return new_action + ' (typed)'
    elif ('form_submit' in old_action) and ('visit' in new_action):
        return new_action + ' (form_submit)'
    elif ('auto_bookmark' in old_action) and ('visit' in new_action):
        return new_action + ' (auto_bookmark)'
    elif ('reload' in old_action) and ('visit' in new_action):
        return new_action + ' (reload)'
    else:
        return new_action

def prepare_output_dataframe(dataframe):
    """Prepare the final output dataframe with the required columns."""
    dataframe = dataframe[['time', 'new_action', 'info', 'timed_url', 'img_file']]
    dataframe.columns = ['time', 'action', 'info', 'timed_url', 'img_file']
    return dataframe

def process_web_data(filename):
    """Main function to process web data and produce the output dataframe."""
    raw_data = read_data(filename)
    parsed_data = parse_data(raw_data)
    dataframe = pd.DataFrame(parsed_data)
    
    dataframe = initialize_columns(dataframe)
    dataframe = filter_unwanted_rows(dataframe)
    dataframe = assign_new_actions(dataframe)
    dataframe = finalize_actions(dataframe)
    output_dataframe = prepare_output_dataframe(dataframe)
    
    return output_dataframe

if __name__ == '__main__':
    web_data_file = sys.argv[1]
    result_df = process_web_data(web_data_file)
    print(result_df.to_csv(index=False, sep='\t', encoding='utf-8-sig'))
