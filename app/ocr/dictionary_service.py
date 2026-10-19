"""The Polish dictionary for the OCR worker, in a process of its own: a JSON list of words on
each input line, a JSON object of corrections on each output line. Morfeusz's native library
is never loaded next to Paddle's (on Windows the OCR process ended with no error)."""
import json
import sys

# Letters OCR confuses with a Polish one: "Spóika" (ł read as i), "ograniczeną" (o as e).
DICT_CONFUSIONS = {
    "i": "łl", "l": "łi", "I": "Ł", "L": "Ł", "e": "ę", "a": "ą", "o": "óą", "c": "ć", "n": "ń", "s": "ś", "z": "żź",
    "E": "Ę", "A": "Ą", "O": "Ó", "C": "Ć", "N": "Ń", "S": "Ś", "Z": "ŻŹ", "ó": "o", "ł": "l",
}


def _dictionary_candidate(core: str, known) -> str | None:
    """The one word the dictionary knows within two confusions of DICT_CONFUSIONS, else None."""
    import itertools

    positions = [index for index, char in enumerate(core) if char in DICT_CONFUSIONS]
    found: set[str] = set()
    for count in (1, 2):
        for combo in itertools.combinations(positions, count):
            for letters in itertools.product(*[DICT_CONFUSIONS[core[index]] for index in combo]):
                chars = list(core)
                for index, letter in zip(combo, letters):
                    chars[index] = letter
                candidate = "".join(chars)
                if known(candidate) or known(candidate.lower()):
                    found.add(candidate)
        if found:
            break
    return found.pop() if len(found) == 1 else None


def main() -> None:
    import morfeusz2

    morfeusz = morfeusz2.Morfeusz(generate=False)
    cache: dict[str, bool] = {}

    def known(word: str) -> bool:
        if word not in cache:
            cache[word] = any(item[2][2] != "ign" for item in morfeusz.analyse(word))
        return cache[word]

    for line in sys.stdin:
        corrections = {}
        for word in json.loads(line):
            if not (known(word) or known(word.lower())):
                candidate = _dictionary_candidate(word, known)
                if candidate:
                    corrections[word] = candidate
        sys.stdout.write(json.dumps(corrections, ensure_ascii=False) + "\n")
        sys.stdout.flush()



if __name__ == "__main__":
    main()
