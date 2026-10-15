import os
import psycopg
from psycopg.rows import dict_row


def connect():
    # No filesystem fallback and no startup DDL. Publish manages production schema.
    return psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row)
