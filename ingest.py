import os
import chromadb
from ollama import embeddings

client = chromadb.PersistentClient(path="./chroma")

collection = client.get_or_create_collection(
    name="documents"
)

DOC_FOLDER = "./docs"


def chunk_text(text, size=1000):
    return [
        text[i:i + size]
        for i in range(0, len(text), size)
    ]


for filename in os.listdir(DOC_FOLDER):

    path = os.path.join(DOC_FOLDER, filename)

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    chunks = chunk_text(content)

    for idx, chunk in enumerate(chunks):

        embedding = embeddings(
            model="nomic-embed-text",
            prompt=chunk
        )

        collection.add(
            ids=[f"{filename}-{idx}"],
            documents=[chunk],
            embeddings=[embedding["embedding"]],
            metadatas=[
                {
                    "file": filename,
                    "chunk": idx
                }
            ]
        )

print("Finished indexing")