"""Column order and types for data/words.csv and data/sentences.csv (see data/SCHEMA.md)."""
SEP = " | "
# (name, type) where type is: str, int, bool (yes/no), list (' | ' separated)
WORD_FIELDS = [
    ("id", "str"), ("lesson", "int"), ("portuguese", "str"), ("english", "str"),
    ("part_of_speech", "str"), ("is_object", "bool"), ("audio", "str"), ("photo", "str"),
    ("photo_credit", "str"), ("scene", "str"), ("root", "str"), ("source_language", "str"),
    ("root_image", "str"), ("definition_pt", "str"), ("literal", "str"), ("parts", "str"),
    ("parts_meaning", "str"), ("origin", "str"), ("history", "list"), ("cognates", "list"),
    ("pt_family", "list"), ("synonyms", "list"), ("antonyms", "list"), ("culture", "list"),
    ("notes", "list"), ("accept_also", "list"), ("tags", "list"),
]
SENTENCE_FIELDS = [
    ("id", "str"), ("word_id", "str"), ("sentence_pt", "str"), ("answer", "str"),
    ("sentence_en", "str"), ("accept_also", "list"),
]
