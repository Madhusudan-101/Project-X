# ingest.py
# One-off / build-time: embed a company-info PDF into the Chroma store the
# interviewer uses for its optional "ask about the company" tool.
#   COMPANY_PDF_PATH=./company.pdf python ingest.py
# Skipping this is fine: the interviewer simply runs without company Q&A.
import os

from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv(".env.local")

pdf_path = os.environ["COMPANY_PDF_PATH"]
persist_directory = os.getenv("CHROMA_DIR", "./chroma_store")

store = Chroma(
    embedding_function=GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001"),
    persist_directory=persist_directory,
    collection_name="company_info",
)
store.reset_collection()  # re-running replaces the content instead of duplicating it
pages = PyPDFLoader(pdf_path).load()
chunks = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200).split_documents(pages)
store.add_documents(chunks)
print(f"Ingested {len(chunks)} chunks from {pdf_path} into {persist_directory}")
