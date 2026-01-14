import os

file_path = 'main.py'

def fix_file():
    print(f"Reading {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # 1. Identify the Split Point
    # The file currently starts with garbage. The real start seems to be the imports.
    # 'from fastapi.responses import JSONResponse' is line 120 (index 119)
    split_marker = 'from fastapi.responses import JSONResponse'
    split_index = -1
    
    for i, line in enumerate(lines):
        if split_marker in line:
            split_index = i
            break
            
    if split_index == -1:
        print("Error: Could not find split marker (fastapi import).")
        return

    print(f"Split marker found at line {split_index + 1}.")
    
    header_garbage = lines[:split_index]
    body_content = lines[split_index:]
    
    # 2. Check if body already has the logic
    # If the logic was already inserted but the header wasn't removed, we just need to save the body.
    body_text = "".join(body_content)
    if "custom_fields =" in body_text and "untranslated_referee.txt" in body_text:
        print("Logic seems to already exist in the body. Just stripping the header.")
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(body_text)
        print("✅ Corrected by stripping header.")
        return

    # 3. If logic is missing in body, we need to process the header and insert it.
    print("Logic missing in body. Processing header to insert it.")
    
    insertion_marker = "match_odds = odds_map.get(fixture['id'], [])"
    insert_index_rel = -1
    for i, line in enumerate(body_content):
        if insertion_marker in line:
            insert_index_rel = i
            break
            
    if insert_index_rel == -1:
        print("Error: Could not find insertion point in body.")
        return
        
    print(f"Insertion point found at relative line {insert_index_rel + 1}.")
    
    # Dedent Logic (Multi-chunk)
    # Chunk 1: 0-28 (Base 80)
    # Chunk 2: 28-80 (Base 60)
    # Chunk 3: 80-99 (Base 40)
    # Chunk 4: 99-end (Base 20)
    
    c1 = header_garbage[:28]
    c2 = header_garbage[28:80]
    c3 = header_garbage[80:99]
    c4 = header_garbage[99:]
    
    clean_lines = []
    
    def process_chunk(chunk_lines, base_indent):
        res = []
        for line in chunk_lines:
            if not line.strip():
                res.append('')
                continue
            curr = len(line) - len(line.lstrip())
            if curr >= base_indent:
                res.append(line[base_indent:].rstrip())
            else:
                res.append(line.strip())
        return res

    clean_lines.extend(process_chunk(c1, 80))
    clean_lines.extend(process_chunk(c2, 60))
    clean_lines.extend(process_chunk(c3, 40))
    clean_lines.extend(process_chunk(c4, 20))
    
    # Indent for insertion (20 spaces)
    target_indent = ' ' * 20
    final_block = []
    for line in clean_lines:
        if line:
            final_block.append(target_indent + line)
        else:
            final_block.append('')
            
    # Construct final file
    final_output = body_content[:insert_index_rel+1] + [l + '\n' for l in final_block] + body_content[insert_index_rel+1:]
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write("".join(final_output))
        
    print("✅ Corrected by cleaning header and inserting into body.")

if __name__ == "__main__":
    fix_file()
