
import os

def optimize_file():
    print("Reading main.py...")
    with open('main.py', 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    print(f"Total lines: {len(lines)}")
    new_lines = []
    
    match_count = 0
    
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Block 1
        if "自动收集到本地文件，便于后续批量修正" in stripped:
            print(f"Found Block 1 at line {i+1}")
            new_lines.append(line)
            # Add exemption pass
            indent = line[:line.find('#')] if '#' in line else '                        '
            new_lines.append(f"{indent}pass # Performance: Disabled file I/O\n")
            # Skip until we find the end of the try/except block
            i += 1
            # Skip the try:
            if i < len(lines) and 'try:' in lines[i]: i+=1
            
            while i < len(lines):
                if '[文件写入异常]' in lines[i]:
                    i += 1 
                    break
                i += 1
            match_count += 1
            continue
            
        # Block 2
        if "通用自动收集和建议补全机制" in stripped:
            print(f"Found Block 2 at line {i+1}")
            new_lines.append(line)
            indent = line[:line.find('#')] if '#' in line else '                    '
            new_lines.append(f"{indent}pass # Performance: Disabled file I/O\n")
            i += 1
            if i < len(lines) and 'try:' in lines[i]: i+=1
            while i < len(lines):
                if '[自定义字段收集写入异常]' in lines[i]:
                    i += 1 
                    break
                i += 1
            match_count += 1
            continue
            
        # Block 3
        if "自动收集未被汉化的比赛状态、事件类型" in stripped:
            print(f"Found Block 3 at line {i+1}")
            new_lines.append(line)
            indent = line[:line.find('#')] if '#' in line else '                    '
            new_lines.append(f"{indent}pass # Performance: Disabled file I/O\n")
            i += 1
            if i < len(lines) and 'try:' in lines[i]: i+=1
            while i < len(lines):
                if '[其它字段收集写入异常]' in lines[i]:
                    i += 1
                    break
                i += 1
            match_count += 1
            continue

        # Block 4
        if "自动收集未被汉化的联赛名" in stripped:
            print(f"Found Block 4 at line {i+1}")
            new_lines.append(line)
            indent = line[:line.find('#')] if '#' in line else '                    '
            new_lines.append(f"{indent}pass # Performance: Disabled file I/O\n")
            i += 1
            if i < len(lines) and 'try:' in lines[i]: i+=1
            while i < len(lines):
                if '[联赛名收集写入异常]' in lines[i]:
                    i += 1
                    break
                i += 1
            match_count += 1
            continue
            
        # Block 5
        if "自动收集未被汉化的队名" in stripped:
            print(f"Found Block 5 at line {i+1}")
            new_lines.append(line)
            indent = line[:line.find('#')] if '#' in line else '                    '
            new_lines.append(f"{indent}pass # Performance: Disabled file I/O\n")
            i += 1
            if i < len(lines) and 'try:' in lines[i]: i+=1
            while i < len(lines):
                if '[队名收集写入异常]' in lines[i]:
                    i += 1
                    break
                i += 1
            match_count += 1
            continue
            
        new_lines.append(line)
        i += 1
        
    print(f"Writing main.py... Matches optimized: {match_count}")
    with open('main.py', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

if __name__ == '__main__':
    optimize_file()
